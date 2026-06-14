export type CLIAction =
  | {
      readonly kind: 'open-repository'
      readonly path: string
      readonly persistSelection?: boolean
    }
  | {
      readonly kind: 'open-worktree'
      readonly repositoryId: number
      readonly worktreePath: string
    }
  | {
      readonly kind: 'clone-url'
      readonly url: string
      readonly branch?: string
    }
