// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TextInputDialog from '../../../src/components/shared/TextInputDialog';

// Covers soft-keyboard submission and asynchronous saves across dialog openings.

type DialogProps = React.ComponentProps<typeof TextInputDialog>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const render = async (props: Partial<DialogProps> = {}) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(React.createElement(TextInputDialog, {
            isOpen: true, title: 'Playlist', initialValue: '  My playlist  ', confirmLabel: 'Save',
            onClose: () => {}, onConfirm: () => {}, ...props,
        }));
    });
};

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

const input = () => document.querySelector<HTMLInputElement>('[data-folia-sheet="true"] input')!;
const pressEnter = (options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    input().dispatchEvent(event);
    return event;
};

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('text input dialog', () => {
    it('submits only once for consecutive Enter presses before React updates the disabled input', async () => {
        const pending = deferred();
        const onConfirm = vi.fn(() => pending.promise);
        const onClose = vi.fn();
        await render({ onConfirm, onClose });
        await act(async () => { pressEnter(); pressEnter(); });

        expect(onConfirm).toHaveBeenCalledExactlyOnceWith('My playlist');
        expect(input().disabled).toBe(true);
        await act(async () => pending.resolve());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps close button, backdrop and Escape inactive while a save is pending', async () => {
        const pending = deferred();
        const onClose = vi.fn();
        await render({ onConfirm: () => pending.promise, onClose });
        await act(async () => { pressEnter(); });
        const sheet = document.querySelector<HTMLElement>('[data-folia-sheet="true"]')!;
        const close = sheet.querySelector<HTMLButtonElement>('header button')!;

        expect(close.getAttribute('aria-disabled')).toBe('true');
        await act(async () => {
            close.click();
            sheet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            sheet.click();
            sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => pending.resolve());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each([
        { isComposing: true },
        { keyCode: 229 },
        { repeat: true },
    ])('leaves composition or repeated Enter alone: %j', async options => {
        const onConfirm = vi.fn();
        await render({ onConfirm });
        let event!: KeyboardEvent;
        await act(async () => { event = pressEnter(options); });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('ignores an old completion after close and reopen, including its pending-state cleanup', async () => {
        const oldSave = deferred();
        const newSave = deferred();
        const oldClose = vi.fn();
        const newClose = vi.fn();
        await render({ onConfirm: () => oldSave.promise, onClose: oldClose });
        await act(async () => { pressEnter(); });
        await render({ isOpen: false });
        await render({ initialValue: 'Second playlist', onConfirm: () => newSave.promise, onClose: newClose });
        await act(async () => { pressEnter(); });
        await act(async () => oldSave.resolve());

        expect(oldClose).not.toHaveBeenCalled();
        expect(newClose).not.toHaveBeenCalled();
        expect(input().disabled).toBe(true);
        await act(async () => newSave.resolve());
        expect(newClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the input and dialog available after a failed save so it can be retried', async () => {
        const pending = deferred();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
        await render({ onConfirm, onClose });
        await act(async () => { pressEnter(); });
        await act(async () => pending.reject(new Error('Save failed')));

        expect(onClose).not.toHaveBeenCalled();
        expect(input().disabled).toBe(false);
        expect(input().value).toBe('  My playlist  ');
        expect(warning).toHaveBeenCalledOnce();
        await act(async () => { pressEnter(); });
        expect(onConfirm).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
