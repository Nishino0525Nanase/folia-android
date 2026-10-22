import React from 'react';
import { useTranslation } from 'react-i18next';
import { SheetButton } from './Sheet';
import ThemedDialog from './ThemedDialog';

// A name-entry dialog whose asynchronous save belongs only to the opening that started it.

interface TextInputDialogProps {
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    confirmLabel?: string;
    initialValue?: string;
    isDaylight?: boolean;
    onClose: () => void;
    onConfirm: (value: string) => Promise<void> | void;
}

const TextInputDialog: React.FC<TextInputDialogProps> = ({
    isOpen,
    title,
    description,
    placeholder,
    confirmLabel,
    initialValue = '',
    isDaylight = false,
    onClose,
    onConfirm,
}) => {
    const { t } = useTranslation();
    const [value, setValue] = React.useState(initialValue);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const sessionRef = React.useRef(0);
    const isOpenRef = React.useRef(false);
    const submittingRef = React.useRef(false);

    React.useLayoutEffect(() => {
        const session = ++sessionRef.current;
        isOpenRef.current = isOpen;
        submittingRef.current = false;
        if (isOpen) {
            setValue(initialValue);
            setIsSubmitting(false);
        }
        return () => {
            if (sessionRef.current === session) {
                ++sessionRef.current;
                isOpenRef.current = false;
                submittingRef.current = false;
            }
        };
    }, [initialValue, isOpen]);

    const requestClose = () => {
        if (!submittingRef.current) onClose();
    };

    const handleConfirm = async () => {
        const trimmedValue = value.trim();
        if (!trimmedValue || !isOpenRef.current || submittingRef.current) {
            return;
        }

        const session = sessionRef.current;
        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            await onConfirm(trimmedValue);
            if (isOpenRef.current && sessionRef.current === session) onClose();
        } catch (error) {
            console.warn('[TextInputDialog] Confirmation failed:', error);
        } finally {
            if (isOpenRef.current && sessionRef.current === session) {
                submittingRef.current = false;
                setIsSubmitting(false);
            }
        }
    };

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={requestClose}
            closeDisabled={isSubmitting}
            isDaylight={isDaylight}
            title={title}
            description={description}
            footer={(
                <>
                    <SheetButton onClick={requestClose} disabled={isSubmitting}>
                        {t('localMusic.cancel')}
                    </SheetButton>
                    <SheetButton variant="primary" onClick={handleConfirm} disabled={isSubmitting || !value.trim()}>
                        {confirmLabel || t('localMusic.save')}
                    </SheetButton>
                </>
            )}
        >
            <input
                // The sheet puts focus here when it opens.
                data-autofocus
                type="text"
                value={value}
                disabled={isSubmitting}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter'
                        && !event.repeat
                        && !event.nativeEvent.isComposing
                        && event.nativeEvent.keyCode !== 229) {
                        event.preventDefault();
                        void handleConfirm();
                    }
                }}
                placeholder={placeholder}
                className="st-t-fast h-11 w-full rounded-lg border border-transparent bg-[var(--st-fill)] px-3 text-base text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:border-[var(--st-accent)] md:h-9 md:text-[13px]"
            />
        </ThemedDialog>
    );
};

export default TextInputDialog;
