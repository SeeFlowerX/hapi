import { getPermissionModeLabel, getPermissionModeTone, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { PermissionModeTone } from '@hapi/protocol'
import { useMemo } from 'react'
import type { AgentState, ModelMode, PermissionMode } from '@/types/api'
import type { ConversationStatus } from '@/realtime/types'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import { useTranslation, type Locale } from '@/lib/use-translation'

// Vibing messages for thinking state
const VIBING_MESSAGES_EN = [
    "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
    "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding", "Coalescing",
    "Cogitating", "Computing", "Combobulating", "Concocting", "Conjuring", "Considering",
    "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Deciphering",
    "Deliberating", "Determining", "Discombobulating", "Divining", "Doing", "Effecting",
    "Elucidating", "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting",
    "Forging", "Forming", "Frolicking", "Generating", "Germinating", "Hatching",
    "Herding", "Honking", "Ideating", "Imagining", "Incubating", "Inferring",
    "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering",
    "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pontificating",
    "Pondering", "Processing", "Puttering", "Puzzling", "Reticulating", "Ruminating",
    "Scheming", "Schlepping", "Shimmying", "Simmering", "Smooshing", "Spelunking",
    "Spinning", "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering",
    "Transmuting", "Unfurling", "Unravelling", "Vibing", "Wandering", "Whirring",
    "Wibbling", "Wizarding", "Working", "Wrangling"
]

const VIBING_MESSAGES_ZH = [
    "处理中", "思考中", "推演中", "规划中", "推理中", "整理中",
    "组合中", "分析中", "计算中", "构思中", "探索中", "推敲中",
    "生成中", "梳理中", "推断中", "验证中", "归纳中", "演算中",
    "构建中", "调度中", "编织中", "处理细节中", "优化中", "回溯中",
    "拟定中", "构想中", "推演方案中", "收敛中", "汇总中", "琢磨中"
]

const PERMISSION_TONE_CLASSES: Record<PermissionModeTone, string> = {
    neutral: 'text-[var(--app-hint)]',
    info: 'text-blue-500',
    warning: 'text-amber-500',
    danger: 'text-red-500'
}

function getConnectionStatus(
    active: boolean,
    thinking: boolean,
    agentState: AgentState | null | undefined,
    voiceStatus: ConversationStatus | undefined,
    t: (key: string) => string,
    locale: Locale
): { text: string; color: string; dotColor: string; isPulsing: boolean } {
    const hasPermissions = agentState?.requests && Object.keys(agentState.requests).length > 0

    // Voice connecting takes priority
    if (voiceStatus === 'connecting') {
        return {
            text: t('voice.connecting'),
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    if (!active) {
        return {
            text: t('misc.offline'),
            color: 'text-[#999]',
            dotColor: 'bg-[#999]',
            isPulsing: false
        }
    }

    if (hasPermissions) {
        return {
            text: t('misc.permissionRequired'),
            color: 'text-[#FF9500]',
            dotColor: 'bg-[#FF9500]',
            isPulsing: true
        }
    }

    if (thinking) {
        const vibingMessages = locale === 'zh-CN' ? VIBING_MESSAGES_ZH : VIBING_MESSAGES_EN
        const picked = vibingMessages[Math.floor(Math.random() * vibingMessages.length)] ?? 'Thinking'
        const vibingMessage = locale === 'zh-CN'
            ? `${picked}…`
            : `${picked.toLowerCase()}…`
        return {
            text: vibingMessage,
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    return {
        text: t('misc.online'),
        color: 'text-[#34C759]',
        dotColor: 'bg-[#34C759]',
        isPulsing: false
    }
}

function getContextWarning(contextSize: number, maxContextSize: number, t: (key: string, params?: Record<string, string | number>) => string): { text: string; color: string } | null {
    const percentageUsed = Math.min(100, Math.max(0, (contextSize / maxContextSize) * 100))

    const percentUsed = Math.round(percentageUsed)
    const percentLeft = Math.max(0, 100 - percentUsed)
    const usedLabel = formatTokensShort(contextSize)
    const limitLabel = formatTokensShort(maxContextSize)
    const text = t('misc.percentLeftWithUsage', { percent: percentLeft, used: usedLabel, limit: limitLabel })
    if (percentageUsed >= 90) {
        return { text, color: 'text-red-500' }
    } else if (percentageUsed >= 70) {
        return { text, color: 'text-amber-500' }
    } else {
        return { text, color: 'text-[var(--app-hint)]' }
    }
}

function formatTokensShort(value: number): string {
    if (value >= 1000) {
        return `${Math.round(value / 1000)}K`
    }
    return String(Math.round(value))
}

export function StatusBar(props: {
    active: boolean
    thinking: boolean
    agentState: AgentState | null | undefined
    contextSize?: number
    modelMode?: ModelMode
    permissionMode?: PermissionMode
    agentFlavor?: string | null
    voiceStatus?: ConversationStatus
}) {
    const { t, locale } = useTranslation()
    const connectionStatus = useMemo(
        () => getConnectionStatus(props.active, props.thinking, props.agentState, props.voiceStatus, t, locale),
        [props.active, props.thinking, props.agentState, props.voiceStatus, t, locale]
    )
    const resolvedContextLimit = useMemo(
        () => props.agentState?.contextLimitTokens ?? getContextBudgetTokens(props.modelMode),
        [props.agentState?.contextLimitTokens, props.modelMode]
    )

    const contextWarning = useMemo(
        () => {
            if (props.contextSize === undefined) return null
            if (!resolvedContextLimit) return null
            return getContextWarning(props.contextSize, resolvedContextLimit, t)
        },
        [props.contextSize, resolvedContextLimit, t]
    )

    const permissionMode = props.permissionMode
    const displayPermissionMode = permissionMode
        && permissionMode !== 'default'
        && isPermissionModeAllowedForFlavor(permissionMode, props.agentFlavor)
        ? permissionMode
        : null

    const permissionModeLabel = displayPermissionMode ? getPermissionModeLabel(displayPermissionMode) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const permissionModeColor = permissionModeTone ? PERMISSION_TONE_CLASSES[permissionModeTone] : 'text-[var(--app-hint)]'
    const usagePercent = useMemo(() => {
        if (props.contextSize === undefined || props.contextSize === null || !resolvedContextLimit) return null
        const percent = Math.min(100, Math.max(0, (props.contextSize / resolvedContextLimit) * 100))
        return percent
    }, [props.contextSize, resolvedContextLimit])
    const usageColor = useMemo(() => {
        if (usagePercent === null) return 'bg-[var(--app-divider)]'
        if (usagePercent >= 90) return 'bg-red-500'
        if (usagePercent >= 80) return 'bg-amber-500'
        return 'bg-green-500'
    }, [usagePercent])

    return (
        <div className="flex flex-col gap-1 px-2 pb-1">
            <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                    <div className="flex items-center gap-1.5">
                        <span
                            className={`h-2 w-2 rounded-full ${connectionStatus.dotColor} ${connectionStatus.isPulsing ? 'animate-pulse' : ''}`}
                        />
                        <span className={`text-xs ${connectionStatus.color}`}>
                            {connectionStatus.text}
                        </span>
                    </div>
                    {contextWarning ? (
                        <span className={`text-[10px] ${contextWarning.color}`}>
                            {contextWarning.text}
                        </span>
                    ) : null}
                </div>

                {displayPermissionMode ? (
                    <span className={`text-xs ${permissionModeColor}`}>
                        {permissionModeLabel}
                    </span>
                ) : null}
            </div>
            {usagePercent !== null ? (
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--app-divider)]">
                    <div className={`h-full ${usageColor}`} style={{ width: `${usagePercent}%` }} />
                </div>
            ) : null}
        </div>
    )
}
