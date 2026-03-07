import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills } from './skills'

async function writeSkill(skillDir: string, name: string, description: string): Promise<void> {
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        '---',
        '',
        `# ${name}`,
    ].join('\n'))
}

describe('listSkills', () => {
    const originalHome = process.env.HOME
    let sandboxDir: string
    let homeDir: string

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-skills-'))
        homeDir = join(sandboxDir, 'home')
        process.env.HOME = homeDir
        await mkdir(homeDir, { recursive: true })
    })

    afterEach(async () => {
        if (originalHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = originalHome
        }

        await rm(sandboxDir, { recursive: true, force: true })
    })

    it('returns empty list when skills directories are missing', async () => {
        await expect(listSkills()).resolves.toEqual([])
    })

    it('lists user skills from ~/.agents and ~/.codex', async () => {
        await writeSkill(join(homeDir, '.agents', 'skills', 'amis'), 'amis', 'AMIS guide')
        await writeSkill(join(homeDir, '.codex', 'skills', 'hello-agents'), 'helloagents', 'Main skill')
        await writeSkill(join(homeDir, '.codex', 'skills', '.system', 'skill-creator'), 'skill-creator', 'Create skills')
        await writeSkill(join(homeDir, '.codex', 'skills', 'public', 'proxy-network-requests'), 'proxy-network-requests', 'Proxy all network requests')

        const skills = await listSkills()

        expect(skills.map((skill) => skill.name)).toEqual([
            'amis',
            'helloagents',
            'proxy-network-requests',
            'skill-creator'
        ])
    })

    it('prefers ~/.agents skill over ~/.codex duplicate', async () => {
        await writeSkill(join(homeDir, '.agents', 'skills', 'shared'), 'shared', 'Agents shared skill')
        await writeSkill(join(homeDir, '.codex', 'skills', 'shared'), 'shared', 'Codex shared skill')

        const skills = await listSkills()
        const sharedSkills = skills.filter((skill) => skill.name === 'shared')

        expect(sharedSkills).toHaveLength(1)
        expect(sharedSkills[0]).toEqual({
            name: 'shared',
            description: 'Agents shared skill'
        })
    })

    it('falls back to directory name when frontmatter is missing', async () => {
        const skillDir = join(homeDir, '.agents', 'skills', 'no-frontmatter')
        await mkdir(skillDir, { recursive: true })
        await writeFile(join(skillDir, 'SKILL.md'), '# No Frontmatter\n')

        await expect(listSkills()).resolves.toEqual([
            { name: 'no-frontmatter', description: undefined }
        ])
    })

    it('loads project skills from cwd up to repo root', async () => {
        const repoRoot = join(sandboxDir, 'repo')
        const packageDir = join(repoRoot, 'packages')
        const workingDirectory = join(packageDir, 'app')

        await mkdir(join(repoRoot, '.git'), { recursive: true })
        await writeSkill(join(repoRoot, '.agents', 'skills', 'root-skill'), 'root-skill', 'Repo root skill')
        await writeSkill(join(repoRoot, '.codex', 'skills', '.system', 'root-system-skill'), 'root-system-skill', 'Repo root system skill')
        await writeSkill(join(packageDir, '.agents', 'skills', 'package-skill'), 'package-skill', 'Package skill')
        await writeSkill(join(packageDir, '.codex', 'skills', 'public', 'package-codex-skill'), 'package-codex-skill', 'Package codex skill')
        await writeSkill(join(workingDirectory, '.agents', 'skills', 'local-skill'), 'local-skill', 'Local skill')
        await writeSkill(join(workingDirectory, '.codex', 'skills', 'local-codex-skill'), 'local-codex-skill', 'Local codex skill')
        await writeSkill(join(sandboxDir, '.codex', 'skills', 'outside-skill'), 'outside-skill', 'Outside repo skill')

        const skills = await listSkills(workingDirectory)

        expect(skills.map((skill) => skill.name)).toEqual([
            'local-codex-skill',
            'local-skill',
            'package-codex-skill',
            'package-skill',
            'root-skill',
            'root-system-skill'
        ])
    })

    it('uses only cwd project skills outside a git repository', async () => {
        const parentDirectory = join(sandboxDir, 'workspace')
        const workingDirectory = join(parentDirectory, 'feature')

        await writeSkill(join(parentDirectory, '.agents', 'skills', 'parent-skill'), 'parent-skill', 'Parent skill')
        await writeSkill(join(workingDirectory, '.agents', 'skills', 'local-skill'), 'local-skill', 'Local skill')
        await writeSkill(join(parentDirectory, '.codex', 'skills', 'parent-codex-skill'), 'parent-codex-skill', 'Parent codex skill')
        await writeSkill(join(workingDirectory, '.codex', 'skills', 'local-codex-skill'), 'local-codex-skill', 'Local codex skill')

        const skills = await listSkills(workingDirectory)

        expect(skills.map((skill) => skill.name)).toEqual(['local-codex-skill', 'local-skill'])
    })

    it('prefers nearest project skill over parent and user duplicates', async () => {
        const repoRoot = join(sandboxDir, 'repo')
        const workingDirectory = join(repoRoot, 'apps', 'web')

        await mkdir(join(repoRoot, '.git'), { recursive: true })
        await writeSkill(join(homeDir, '.agents', 'skills', 'shared'), 'shared', 'User shared skill')
        await writeSkill(join(homeDir, '.codex', 'skills', 'shared'), 'shared', 'User codex shared skill')
        await writeSkill(join(repoRoot, '.agents', 'skills', 'shared'), 'shared', 'Repo shared skill')
        await writeSkill(join(repoRoot, '.codex', 'skills', 'shared'), 'shared', 'Repo codex shared skill')
        await writeSkill(join(workingDirectory, '.agents', 'skills', 'shared'), 'shared', 'Local shared skill')
        await writeSkill(join(workingDirectory, '.codex', 'skills', 'shared'), 'shared', 'Local codex shared skill')

        const skills = await listSkills(workingDirectory)
        const sharedSkills = skills.filter((skill) => skill.name === 'shared')

        expect(sharedSkills).toHaveLength(1)
        expect(sharedSkills[0]).toEqual({
            name: 'shared',
            description: 'Local shared skill'
        })
    })
})
