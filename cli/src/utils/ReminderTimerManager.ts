import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';

const DEFAULT_INTERVAL_SEC = 10;
const DEFAULT_TIMEOUT_FACTOR = 20;
const DEFAULT_TIMEOUT_MAX_SEC = 30 * 60;

export type ReminderStartInput = {
    id?: string;
    intervalSec?: number;
    timeoutSec?: number;
    message: string;
    onTimeoutMessage?: string;
};

export type ReminderExtendInput = {
    timerId: string;
    extendSec?: number;
    timeoutSec?: number;
};

export type ReminderStartResult = {
    timerId: string;
    startedAt: number;
    nextAt: number;
    timeoutAt: number;
};

export type ReminderExtendResult = {
    ok: boolean;
    timeoutAt?: number;
    error?: string;
};

export type ReminderStopResult = {
    ok: boolean;
    error?: string;
};

type ReminderTimer = {
    id: string;
    intervalMs: number;
    timeoutAt: number;
    startAt: number;
    nextAt: number;
    tickCount: number;
    message: string;
    onTimeoutMessage?: string;
    pendingTick: boolean;
    pendingTimeout: boolean;
    intervalHandle: NodeJS.Timeout;
    timeoutHandle: NodeJS.Timeout;
    stopped: boolean;
    expired: boolean;
};

export type ReminderTimerManagerOptions<Mode> = {
    getMode: () => Mode;
    enqueueMessage: (message: string, mode: Mode) => void;
    isBusy: () => boolean;
};

export class ReminderTimerManager<Mode> {
    private timers = new Map<string, ReminderTimer>();
    private readonly getMode: () => Mode;
    private readonly enqueueMessage: (message: string, mode: Mode) => void;
    private readonly isBusy: () => boolean;

    constructor(options: ReminderTimerManagerOptions<Mode>) {
        this.getMode = options.getMode;
        this.enqueueMessage = options.enqueueMessage;
        this.isBusy = options.isBusy;
    }

    start(input: ReminderStartInput): ReminderStartResult {
        const now = Date.now();
        const intervalSec = normalizePositiveNumber(input.intervalSec, DEFAULT_INTERVAL_SEC);
        const intervalMs = intervalSec * 1000;
        const timeoutSec = normalizePositiveNumber(
            input.timeoutSec,
            Math.min(intervalSec * DEFAULT_TIMEOUT_FACTOR, DEFAULT_TIMEOUT_MAX_SEC)
        );
        const timeoutMs = timeoutSec * 1000;

        const timerId = input.id?.trim() || randomUUID();
        if (this.timers.has(timerId)) {
            this.stop(timerId);
        }

        const timeoutAt = now + timeoutMs;
        const nextAt = now + intervalMs;

        const timer: ReminderTimer = {
            id: timerId,
            intervalMs,
            timeoutAt,
            startAt: now,
            nextAt,
            tickCount: 0,
            message: input.message,
            onTimeoutMessage: input.onTimeoutMessage,
            pendingTick: false,
            pendingTimeout: false,
            intervalHandle: setInterval(() => this.handleTick(timerId), intervalMs),
            timeoutHandle: setTimeout(() => this.handleTimeout(timerId), timeoutMs),
            stopped: false,
            expired: false
        };

        this.timers.set(timerId, timer);
        logger.debug(`[Reminder] Started timer ${timerId} interval=${intervalSec}s timeout=${timeoutSec}s`);

        this.handleIdle();

        return {
            timerId,
            startedAt: timer.startAt,
            nextAt: timer.nextAt,
            timeoutAt: timer.timeoutAt
        };
    }

    stop(timerId: string): ReminderStopResult {
        const timer = this.timers.get(timerId);
        if (!timer) {
            return { ok: false, error: 'Timer not found' };
        }
        this.clearTimerHandles(timer);
        this.timers.delete(timerId);
        logger.debug(`[Reminder] Stopped timer ${timerId}`);
        return { ok: true };
    }

    extend(input: ReminderExtendInput): ReminderExtendResult {
        const timer = this.timers.get(input.timerId);
        if (!timer) {
            return { ok: false, error: 'Timer not found' };
        }

        const now = Date.now();
        let timeoutAt = timer.timeoutAt;

        if (typeof input.timeoutSec === 'number' && Number.isFinite(input.timeoutSec) && input.timeoutSec > 0) {
            timeoutAt = now + Math.round(input.timeoutSec * 1000);
        } else if (typeof input.extendSec === 'number' && Number.isFinite(input.extendSec) && input.extendSec > 0) {
            timeoutAt = timer.timeoutAt + Math.round(input.extendSec * 1000);
        } else {
            return { ok: false, error: 'extendSec or timeoutSec required' };
        }

        timer.timeoutAt = timeoutAt;
        timer.pendingTimeout = false;

        if (timer.stopped || timer.expired) {
            this.reviveTimer(timer, now);
        } else {
            clearTimeout(timer.timeoutHandle);
            const timeoutMs = Math.max(0, timeoutAt - now);
            timer.timeoutHandle = setTimeout(() => this.handleTimeout(timer.id), timeoutMs);
        }

        logger.debug(`[Reminder] Extended timer ${timer.id} to ${timeoutAt}`);
        return { ok: true, timeoutAt };
    }

    handleIdle(): void {
        for (const timer of this.timers.values()) {
            if (timer.stopped) continue;
            if (this.isBusy()) continue;

            const now = Date.now();
            if (timer.pendingTimeout || now >= timer.timeoutAt) {
                timer.pendingTimeout = false;
                this.sendTimeout(timer, now);
                this.expireTimer(timer);
                continue;
            }

            if (timer.pendingTick) {
                timer.pendingTick = false;
                this.sendTick(timer, now);
            }
        }
    }

    shutdown(): void {
        for (const timerId of Array.from(this.timers.keys())) {
            this.stop(timerId);
        }
    }

    private handleTick(timerId: string): void {
        const timer = this.timers.get(timerId);
        if (!timer || timer.stopped) {
            return;
        }

        const now = Date.now();
        if (now >= timer.timeoutAt) {
            this.handleTimeout(timerId);
            return;
        }

        if (this.isBusy()) {
            timer.pendingTick = true;
            return;
        }

        this.sendTick(timer, now);
    }

    private handleTimeout(timerId: string): void {
        const timer = this.timers.get(timerId);
        if (!timer || timer.stopped) {
            return;
        }

        const now = Date.now();
        if (this.isBusy()) {
            timer.pendingTimeout = true;
            return;
        }

        this.sendTimeout(timer, now);
        this.expireTimer(timer);
    }

    private sendTick(timer: ReminderTimer, now: number): void {
        timer.tickCount += 1;
        timer.nextAt = now + timer.intervalMs;

        const elapsedSec = Math.floor((now - timer.startAt) / 1000);
        const remainingSec = Math.max(0, Math.ceil((timer.timeoutAt - now) / 1000));
        const message = `[HAPI_REMINDER TICK id=${timer.id} n=${timer.tickCount} elapsed=${elapsedSec}s remaining=${remainingSec}s]\n${timer.message}`;

        this.enqueueMessage(message, this.getMode());
    }

    private sendTimeout(timer: ReminderTimer, now: number): void {
        const elapsedSec = Math.floor((now - timer.startAt) / 1000);
        const fallback = '已超时，请决定：继续/停止/改方案';
        const message = `[HAPI_REMINDER TIMEOUT id=${timer.id} elapsed=${elapsedSec}s]\n${timer.onTimeoutMessage ?? fallback}`;

        this.enqueueMessage(message, this.getMode());
    }

    private clearTimerHandles(timer: ReminderTimer): void {
        if (!timer.stopped) {
            clearInterval(timer.intervalHandle);
            clearTimeout(timer.timeoutHandle);
        }
        timer.stopped = true;
    }

    private expireTimer(timer: ReminderTimer): void {
        if (timer.expired) return;
        this.clearTimerHandles(timer);
        timer.expired = true;
        logger.debug(`[Reminder] Timer expired ${timer.id}`);
    }

    private reviveTimer(timer: ReminderTimer, now: number): void {
        timer.expired = false;
        timer.stopped = false;
        timer.pendingTick = false;
        timer.pendingTimeout = false;
        timer.nextAt = now + timer.intervalMs;

        const timeoutMs = Math.max(0, timer.timeoutAt - now);
        timer.intervalHandle = setInterval(() => this.handleTick(timer.id), timer.intervalMs);
        timer.timeoutHandle = setTimeout(() => this.handleTimeout(timer.id), timeoutMs);
        logger.debug(`[Reminder] Timer revived ${timer.id}`);
    }
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.round(value);
}
