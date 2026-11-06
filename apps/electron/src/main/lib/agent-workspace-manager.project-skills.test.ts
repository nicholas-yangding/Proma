import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertNotProjectSkill,
  mergeWorkspaceSkillsWithProject,
  scanProjectSkillDirs,
} from './agent-workspace-manager'

function makeSkillDir(root: string, sourceDir: string, slug: string, name?: string): void {
  const dir = join(root, sourceDir, slug)
  mkdirSync(dir, { recursive: true })
  const frontmatter = name ? `---\nname: ${name}\n---\n\n` : ''
  writeFileSync(join(dir, 'SKILL.md'), `${frontmatter}# ${slug} 正文`)
}

function makeProjectRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'proma-project-skills-')))
}

describe('Given 项目根 When 扫描只读 Skill 目录', () => {
  test('Then .agents/skills 与 .claude/skills 的 Skill 被扫出并携带 project 来源', () => {
    const root = makeProjectRoot()
    try {
      makeSkillDir(root, '.agents/skills', 'en-zh-translation', 'EN→ZH 翻译')
      makeSkillDir(root, '.claude/skills', 'knap')
      const skills = scanProjectSkillDirs(root)
      expect(skills.map((meta) => meta.slug)).toEqual(['en-zh-translation', 'knap'])
      expect(skills[0]).toMatchObject({ name: 'EN→ZH 翻译', enabled: true, source: 'project' })
      expect(skills[0]?.sourcePath).toBe(join(root, '.agents/skills', 'en-zh-translation'))
      expect(skills[1]?.name).toBe('knap')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Then 同名 slug 只保留 .agents 版本', () => {
    const root = makeProjectRoot()
    try {
      makeSkillDir(root, '.agents/skills', 'defuddle')
      makeSkillDir(root, '.claude/skills', 'defuddle')
      const skills = scanProjectSkillDirs(root)
      expect(skills).toHaveLength(1)
      expect(skills[0]?.sourcePath).toBe(join(root, '.agents/skills', 'defuddle'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Then 项目根未绑定或目录缺失时返回空数组', () => {
    expect(scanProjectSkillDirs(undefined)).toEqual([])
    const emptyRoot = makeProjectRoot()
    try {
      expect(scanProjectSkillDirs(emptyRoot)).toEqual([])
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
    const missingRoot = join(makeProjectRoot(), 'not-exist')
    rmSync(missingRoot, { force: true })
    expect(scanProjectSkillDirs(missingRoot)).toEqual([])
  })

  test('Then 无 SKILL.md 的子目录被跳过', () => {
    const root = makeProjectRoot()
    try {
      mkdirSync(join(root, '.agents/skills/plain-dir'), { recursive: true })
      writeFileSync(join(root, '.agents/skills/plain-dir/README.md'), '不是 Skill')
      makeSkillDir(root, '.agents/skills', 'real-skill')
      expect(scanProjectSkillDirs(root).map((meta) => meta.slug)).toEqual(['real-skill'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Given 受管 Skills 与项目只读 Skills When 合并', () => {
  test('Then 受管条目恒优先（含禁用态），项目条目按原顺序追加在尾部', () => {
    const workspaceSkills: SkillMetaFixture[] = [
      { slug: 'shared-skill', name: '受管版本', enabled: true },
      { slug: 'disabled-skill', name: '受管禁用', enabled: false },
      { slug: 'workspace-only', name: '仅受管', enabled: true },
    ]
    const projectSkills: SkillMetaFixture[] = [
      { slug: 'shared-skill', name: '项目版本', enabled: true, source: 'project' as const },
      { slug: 'project-only', name: '仅项目', enabled: true, source: 'project' as const },
    ]
    const merged = mergeWorkspaceSkillsWithProject(workspaceSkills, projectSkills)
    expect(merged.map((meta) => meta.slug)).toEqual(['shared-skill', 'disabled-skill', 'workspace-only', 'project-only'])
    expect(merged.find((meta) => meta.slug === 'shared-skill')?.name).toBe('受管版本')
  })
})

type SkillMetaFixture = {
  slug: string
  name: string
  enabled: boolean
  source?: 'workspace' | 'project'
  sourcePath?: string
}

describe('Given 项目只读 Skill When 调用禁用或删除守卫', () => {
  const skills: SkillMetaFixture[] = [
    { slug: 'managed', name: '受管', enabled: true },
    { slug: 'project-ref', name: '项目引用', enabled: true, source: 'project' as const, sourcePath: '/tmp/x/.agents/skills/project-ref' },
  ]

  test('Then project 条目抛只读错误', () => {
    expect(() => assertNotProjectSkill(skills, 'project-ref')).toThrow('只读引用')
  })

  test('Then 受管条目与未知 slug 放行', () => {
    expect(() => assertNotProjectSkill(skills, 'managed')).not.toThrow()
    expect(() => assertNotProjectSkill(skills, 'not-exist')).not.toThrow()
  })
})
