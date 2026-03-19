import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'

export function DirectorySection(props: {
    directory: string
    isDisabled: boolean
    recentPaths: string[]
    browser?: ReactNode
    isBrowserOpen?: boolean
    onBrowserOpenChange?: (open: boolean) => void
    onDirectoryClick: () => void
    statusMessage?: string | null
    statusTone?: 'warning' | 'error' | null
    onPathClick: (path: string) => void
}) {
    const { t } = useTranslation()
    const showBrowser = Boolean(props.browser)

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.directory')}
            </label>
            <div className="relative">
                <input
                    type="text"
                    placeholder={t('newSession.placeholder')}
                    value={props.directory}
                    onFocus={props.onDirectoryClick}
                    readOnly
                    disabled={props.isDisabled}
                    className="w-full cursor-pointer rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                />
            </div>

            {props.recentPaths.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('newSession.recent')}:</span>
                    <div className="flex flex-wrap gap-1">
                        {props.recentPaths.map((path) => (
                            <button
                                key={path}
                                type="button"
                                onClick={() => props.onPathClick(path)}
                                disabled={props.isDisabled}
                                className="rounded bg-[var(--app-subtle-bg)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors truncate max-w-[200px] disabled:opacity-50"
                                title={path}
                            >
                                {path}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {showBrowser ? (
                <Dialog
                    open={Boolean(props.isBrowserOpen)}
                    onOpenChange={props.onBrowserOpenChange}
                >
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>{t('newSession.browse.title')}</DialogTitle>
                        </DialogHeader>
                        {props.browser}
                    </DialogContent>
                </Dialog>
            ) : null}

            {props.statusMessage ? (
                <div
                    className={`mt-1 rounded-md px-2 py-1 text-xs ${
                        props.statusTone === 'error'
                            ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                            : 'bg-amber-500/10 text-[var(--app-hint)]'
                    }`}
                >
                    {props.statusMessage}
                </div>
            ) : null}
        </div>
    )
}
