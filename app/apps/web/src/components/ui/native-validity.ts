import type { FormEvent } from 'react';

type NativeValidityEvent = FormEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

export const nativeValidityProps = (message: string) => ({
  onInvalid: (event: NativeValidityEvent) => {
    if (event.currentTarget.validity.valueMissing) event.currentTarget.setCustomValidity(message);
  },
  onInput: (event: NativeValidityEvent) => {
    event.currentTarget.setCustomValidity('');
  },
});
