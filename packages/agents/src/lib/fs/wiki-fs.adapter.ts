import { readFile, writeFile, readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { validateFileSystemPath } from '@ethra-nexus/core'

// ============================================================
// Wiki FS Adapter — acesso seguro ao filesystem das wikis
//
// Implementa IngestDeps.fs e LintDeps.fs
// Todos os caminhos são validados contra path traversal.
// ============================================================

export class WikiFsAdapter {
  private basePath: string

  constructor(basePath?: string) {
    this.basePath = resolve(basePath ?? process.env['WIKIS_BASE_PATH'] ?? './wikis')
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolveSafePath(path)
    return readFile(fullPath, 'utf8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolveSafePath(path)
    await writeFile(fullPath, content, 'utf8')
  }

  async listFiles(dir: string, _pattern?: string): Promise<string[]> {
    const fullDir = this.resolveSafePath(dir)
    return this.walkDir(fullDir)
  }

  // Retorna o path absoluto de um arquivo raw source
  getRawSourcePath(wikiScope: string, filename: string): string {
    return this.resolveSafePath(join(wikiScope, 'raw', filename))
  }

  private resolveSafePath(relativePath: string): string {
    const fullPath = resolve(this.basePath, relativePath)
    validateFileSystemPath(fullPath.replace(/\\/g, '/'), this.basePath.replace(/\\/g, '/'))
    return fullPath
  }

  private async walkDir(dir: string): Promise<string[]> {
    const files: string[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          const subFiles = await this.walkDir(entryPath)
          files.push(...subFiles)
        } else if (entry.name.endsWith('.md')) {
          // Retorna path relativo ao dir base
          const relative = entryPath
            .replace(this.basePath, '')
            .replace(/\\/g, '/')
            .replace(/^\//, '')
          files.push(relative)
        }
      }
    } catch {
      // Diretório pode não existir — retorna vazio
    }
    return files
  }
}
