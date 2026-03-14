import { access, readdir, readFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';

export interface SkillSummary {
    name: string;
    description?: string;
}

export interface ListSkillsRequest {
}

export interface ListSkillsResponse {
    success: boolean;
    skills?: SkillSummary[];
    error?: string;
}

function getHomeDirectory(): string {
    return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function getUserSkillsRoots(): string[] {
    const homeDirectory = getHomeDirectory();
    const codexHome = process.env.CODEX_HOME ?? join(homeDirectory, '.codex');
    return [
        join(homeDirectory, '.agents', 'skills'),
        join(homeDirectory, '.claude', 'skills'),
        join(codexHome, 'skills'),
    ];
}

function getAdminSkillsRoot(): string {
    return join('/etc', 'codex', 'skills');
}

function getProjectSkillsRoots(directory: string): string[] {
    return [
        join(directory, '.agents', 'skills'),
        join(directory, '.claude', 'skills'),
        join(directory, '.codex', 'skills'),
    ];
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function listProjectSkillsRoots(workingDirectory?: string): Promise<string[]> {
    if (!workingDirectory) {
        return [];
    }

    const resolvedWorkingDirectory = resolve(workingDirectory);
    const directories = [resolvedWorkingDirectory];
    let currentDirectory = resolvedWorkingDirectory;

    while (true) {
        if (await pathExists(join(currentDirectory, '.git'))) {
            return directories.flatMap(getProjectSkillsRoots);
        }

        const parentDirectory = dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            return getProjectSkillsRoots(resolvedWorkingDirectory);
        }

        currentDirectory = parentDirectory;
        directories.push(currentDirectory);
    }
}

function parseFrontmatter(fileContent: string): { frontmatter?: Record<string, unknown>; body: string } {
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { body: fileContent.trim() };
    }

    const yamlContent = match[1];
    const body = match[2].trim();
    try {
        const parsed = parseYaml(yamlContent) as Record<string, unknown> | null;
        return { frontmatter: parsed ?? undefined, body };
    } catch {
        return { body: fileContent.trim() };
    }
}

function extractSkillSummary(skillDir: string, fileContent: string): SkillSummary | null {
    const parsed = parseFrontmatter(fileContent);
    const nameFromFrontmatter = typeof parsed.frontmatter?.name === 'string' ? parsed.frontmatter.name.trim() : '';
    const name = nameFromFrontmatter || basename(skillDir);
    if (!name) {
        return null;
    }

    const description = typeof parsed.frontmatter?.description === 'string'
        ? parsed.frontmatter.description.trim()
        : undefined;

    return { name, description };
}

async function listTopLevelSkillDirs(skillsRoot: string): Promise<string[]> {
    const result: string[] = [];

    async function collectSkillDirs(directory: string, depth: number): Promise<void> {
        if (depth > 3) {
            return;
        }

        try {
            await access(join(directory, 'SKILL.md'));
            result.push(directory);
            return;
        } catch {
            // ignore missing SKILL.md
        }

        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            await collectSkillDirs(join(directory, entry.name), depth + 1);
        }
    }

    await collectSkillDirs(skillsRoot, 0);
    return result;
}

async function readSkillsFromDirs(skillDirs: string[]): Promise<SkillSummary[]> {
    const skills = await Promise.all(skillDirs.map(async (dir): Promise<SkillSummary | null> => {
        const filePath = join(dir, 'SKILL.md');
        try {
            const fileContent = await readFile(filePath, 'utf-8');
            return extractSkillSummary(dir, fileContent);
        } catch {
            return null;
        }
    }));

    return skills.filter((skill): skill is SkillSummary => skill !== null);
}

export async function listSkills(workingDirectory?: string): Promise<SkillSummary[]> {
    const projectRoots = await listProjectSkillsRoots(workingDirectory);
    const userRoots = getUserSkillsRoots();
    const [projectSkillDirs, userSkillDirs, adminSkillDirs] = await Promise.all([
        Promise.all(projectRoots.map(async (root) => await listTopLevelSkillDirs(root))).then((dirs) => dirs.flat()),
        Promise.all(userRoots.map(async (root) => await listTopLevelSkillDirs(root))).then((dirs) => dirs.flat()),
        listTopLevelSkillDirs(getAdminSkillsRoot()),
    ]);

    const [projectSkills, userSkills, adminSkills] = await Promise.all([
        readSkillsFromDirs(projectSkillDirs),
        readSkillsFromDirs(userSkillDirs),
        readSkillsFromDirs(adminSkillDirs),
    ]);

    const dedupedSkills = new Map<string, SkillSummary>();
    for (const skill of [
        ...projectSkills,
        ...userSkills,
        ...adminSkills,
    ]) {
        if (!dedupedSkills.has(skill.name)) {
            dedupedSkills.set(skill.name, skill);
        }
    }

    return [...dedupedSkills.values()].sort((a, b) => a.name.localeCompare(b.name));
}
