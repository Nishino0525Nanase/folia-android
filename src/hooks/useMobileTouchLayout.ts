import { useMediaQuery } from './useMediaQuery';

// Shares the same phone/touch breakpoint between navigation and playback controls.
export const MOBILE_TOUCH_LAYOUT_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)';

export const useMobileTouchLayout = (): boolean => useMediaQuery(MOBILE_TOUCH_LAYOUT_QUERY);
