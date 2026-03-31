import { useEffect, useMemo, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useShikiHighlighter } from '@/lib/shiki'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'
import { formatShellCommandForDisplay } from '@/lib/formatShellCommand'

export function CodeBlock(props: {
    code: string
    language?: string
    showCopyButton?: boolean
    formattedCode?: string
    enableShellFormat?: boolean
}) {
    const { t } = useTranslation()
    const showCopyButton = props.showCopyButton ?? true
    const { copied, copy } = useCopyToClipboard()
    const [showFormatted, setShowFormatted] = useState(false)
    const formattedCode = useMemo(() => {
        if (props.formattedCode) return props.formattedCode
        return props.enableShellFormat ? formatShellCommandForDisplay(props.code) : props.code
    }, [props.code, props.enableShellFormat, props.formattedCode])
    const hasFormattedVariant = formattedCode !== props.code

    useEffect(() => {
        if (!hasFormattedVariant && showFormatted) {
            setShowFormatted(false)
        }
    }, [hasFormattedVariant, showFormatted])

    const displayCode = showFormatted && hasFormattedVariant ? formattedCode : props.code
    const highlighted = useShikiHighlighter(displayCode, props.language)

    return (
        <div className="relative min-w-0 max-w-full">
            {showCopyButton ? (
                <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                    {hasFormattedVariant ? (
                        <button
                            type="button"
                            onClick={() => setShowFormatted((prev) => !prev)}
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                            title={showFormatted ? t('code.raw') : t('code.format')}
                        >
                            {showFormatted ? 'RAW' : 'FMT'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => copy(displayCode)}
                        className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        title={t('code.copy')}
                    >
                        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            ) : null}

            <div className="min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-md bg-[var(--app-code-bg)]">
                <pre className="shiki m-0 w-max min-w-full p-2 pr-8 text-xs font-mono">
                    <code className="block">{highlighted ?? displayCode}</code>
                </pre>
            </div>
        </div>
    )
}
