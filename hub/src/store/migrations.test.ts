import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

function createLegacyDatabase(version: 3 | 4 | 5): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-store-migration-'))
    const dbPath = join(dir, 'hapi.db')
    tempDirs.push(dir)

    const db = new Database(dbPath, { create: true, readwrite: true })
    const hasTeamState = version >= 4

    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            todos TEXT,
            todos_updated_at INTEGER,
            ${hasTeamState ? 'team_state TEXT,' : ''}
            ${hasTeamState ? 'team_state_updated_at INTEGER,' : ''}
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            runner_state TEXT,
            runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );

        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            UNIQUE(platform, platform_user_id)
        );

        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );
    `)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version, agent_state, agent_state_version,
            todos, todos_updated_at${hasTeamState ? ', team_state, team_state_updated_at' : ''},
            active, active_at, seq
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?${hasTeamState ? ', ?, ?' : ''},
            ?, ?, ?
        )
    `).run(
        'session-1',
        'tag',
        'default',
        null,
        100,
        200,
        '{"path":"/tmp/project"}',
        1,
        null,
        1,
        null,
        null,
        ...(hasTeamState ? [null, null] : []),
        1,
        200,
        7
    )

    db.exec(`PRAGMA user_version = ${version}`)
    db.close()

    return dbPath
}

describe('Store schema migrations', () => {
    for (const version of [3, 4, 5] as const) {
        it(`migrates schema v${version} to current`, () => {
            const dbPath = createLegacyDatabase(version)

            const store = new Store(dbPath)
            const db = new Database(dbPath, { create: false, readwrite: true, strict: true })

            const userVersion = db.query('PRAGMA user_version').get() as { user_version: number }
            const columns = db.query('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
            const session = store.sessions.getSessionByNamespace('session-1', 'default')

            expect(userVersion.user_version).toBe(6)
            expect(columns.map((column) => column.name)).toContain('effort')
            expect(columns.map((column) => column.name)).toContain('team_state')
            expect(columns.map((column) => column.name)).toContain('team_state_updated_at')
            expect(session).toEqual(expect.objectContaining({ id: 'session-1', seq: 7, active: true }))

            db.close()
        })
    }
})
