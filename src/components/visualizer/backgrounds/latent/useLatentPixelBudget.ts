import { useLayoutEffect, useState, type RefObject } from 'react';
import { useMediaQuery } from '../../../../hooks/useMediaQuery';

// The soft full-screen background needs CSS-pixel detail on phones, independently of lyric resolution.

export const LATENT_MAX_SHADER_PIXELS = 1280 * 720;
const PHONE_TOUCH_QUERY = '(max-width: 767px) and (pointer: coarse)';

export const resolveLatentPixelBudget = (isPhoneTouch: boolean, width: number, height: number): number => {
    if (!isPhoneTouch || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return LATENT_MAX_SHADER_PIXELS;
    }
    return Math.min(LATENT_MAX_SHADER_PIXELS, Math.ceil(width) * Math.ceil(height));
};

export const useLatentPixelBudget = (ref: RefObject<HTMLElement | null>): number => {
    const isPhoneTouch = useMediaQuery(PHONE_TOUCH_QUERY);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const element = ref.current;
        if (!isPhoneTouch || !element) return;

        const read = () => {
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
        };
        read();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(read);
        observer.observe(element);
        return () => observer.disconnect();
    }, [isPhoneTouch, ref]);

    return resolveLatentPixelBudget(isPhoneTouch, size.width, size.height);
};
