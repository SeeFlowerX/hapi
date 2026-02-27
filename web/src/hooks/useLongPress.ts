import type React from 'react'
import { useCallback, useRef } from 'react'

type UseLongPressOptions = {
    onLongPress: (point: { x: number; y: number }) => void
    onClick?: () => void
    threshold?: number
    moveThreshold?: number
    disabled?: boolean
}

type UseLongPressHandlers = {
    onPointerDown: React.PointerEventHandler
    onPointerUp: React.PointerEventHandler
    onPointerMove: React.PointerEventHandler
    onPointerCancel: React.PointerEventHandler
    onContextMenu: React.MouseEventHandler
    onKeyDown: React.KeyboardEventHandler
}

export function useLongPress(options: UseLongPressOptions): UseLongPressHandlers {
    const { onLongPress, onClick, threshold = 500, moveThreshold = 8, disabled = false } = options

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isLongPressRef = useRef(false)
    const touchMoved = useRef(false)
    const pressPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
    const activePointerId = useRef<number | null>(null)
    const activePointerType = useRef<string | null>(null)

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    const startTimer = useCallback((clientX: number, clientY: number, pointerType: string) => {
        clearTimer()
        isLongPressRef.current = false
        touchMoved.current = false
        pressPointRef.current = { x: clientX, y: clientY }

        if (disabled || pointerType === 'mouse') {
            return
        }

        timerRef.current = setTimeout(() => {
            isLongPressRef.current = true
            onLongPress(pressPointRef.current)
        }, threshold)
    }, [disabled, clearTimer, onLongPress, threshold])

    const handleEnd = useCallback((shouldTriggerClick: boolean) => {
        clearTimer()

        if (shouldTriggerClick && !isLongPressRef.current && !touchMoved.current && onClick) {
            onClick()
        }

        isLongPressRef.current = false
        touchMoved.current = false
    }, [clearTimer, onClick])

    const onPointerDown = useCallback<React.PointerEventHandler>((e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        activePointerId.current = e.pointerId
        activePointerType.current = e.pointerType
        startTimer(e.clientX, e.clientY, e.pointerType)
        if (e.pointerType !== 'mouse') {
            try {
                e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
            }
        }
    }, [startTimer])

    const onPointerUp = useCallback<React.PointerEventHandler>((e) => {
        if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return
        if (isLongPressRef.current && activePointerType.current !== 'mouse') {
            e.preventDefault()
        }
        handleEnd(!isLongPressRef.current)
        activePointerId.current = null
        activePointerType.current = null
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
        }
    }, [handleEnd])

    const onPointerMove = useCallback<React.PointerEventHandler>((e) => {
        if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return
        const dx = e.clientX - pressPointRef.current.x
        const dy = e.clientY - pressPointRef.current.y
        if (Math.hypot(dx, dy) <= moveThreshold) {
            return
        }
        touchMoved.current = true
        clearTimer()
    }, [clearTimer, moveThreshold])

    const onPointerCancel = useCallback<React.PointerEventHandler>((e) => {
        if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return
        handleEnd(false)
        activePointerId.current = null
        activePointerType.current = null
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
        }
    }, [handleEnd])

    const onContextMenu = useCallback<React.MouseEventHandler>((e) => {
        if (!disabled) {
            e.preventDefault()
            clearTimer()
            isLongPressRef.current = true
            onLongPress({ x: e.clientX, y: e.clientY })
        }
    }, [disabled, clearTimer, onLongPress])

    const onKeyDown = useCallback<React.KeyboardEventHandler>((e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
        }
    }, [disabled, onClick])

    return {
        onPointerDown,
        onPointerUp,
        onPointerMove,
        onPointerCancel,
        onContextMenu,
        onKeyDown
    }
}
