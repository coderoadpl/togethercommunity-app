import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { ImageAssetField } from './ImageAssetField.js';

const viewProps = {
  accept: 'image/png,image/jpeg,image/webp',
  allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'],
  maxBytes: 1024,
};

describe('ImageAssetField', () => {
  it('keeps the URL input as an alternative', async () => {
    const onChange = vi.fn();
    render(
      <ImageAssetField
        id="cover"
        label="Okładka"
        value=""
        onChange={onChange}
        {...viewProps}
        testId="cover"
        onUpload={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Okładka'), {
      target: { value: 'https://cdn.test/cover.jpg' },
    });

    expect(onChange).toHaveBeenLastCalledWith('https://cdn.test/cover.jpg');
  });

  it('keeps an uploaded root-relative path valid in a form field', () => {
    render(
      <ImageAssetField
        id="cover"
        label="Okładka"
        value="/api/public/assets/course-cover/00000000-0000-4000-8000-000000000001.jpg"
        onChange={() => undefined}
        {...viewProps}
        testId="cover"
        onUpload={() => undefined}
      />,
    );

    expect(screen.getByTestId('cover')).toBeValid();
  });

  it('passes an accepted file to the upload action', async () => {
    const onUpload = vi.fn();
    render(
      <ImageAssetField
        id="cover"
        label="Okładka"
        value=""
        onChange={() => undefined}
        {...viewProps}
        testId="cover"
        onUpload={onUpload}
      />,
    );

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('cover-file-input'), file);

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('validates content type and size before starting an upload', async () => {
    render(
      <ImageAssetField
        id="cover"
        label="Okładka"
        value=""
        onChange={() => undefined}
        {...viewProps}
        testId="cover"
        onUpload={() => undefined}
      />,
    );

    await userEvent.upload(
      screen.getByTestId('cover-file-input'),
      new File(['gif'], 'cover.gif', { type: 'image/gif' }),
      { applyAccept: false },
    );
    expect(await screen.findByText(pl.imageAssets.invalidType)).toBeInTheDocument();

    await userEvent.upload(
      screen.getByTestId('cover-file-input'),
      new File([new Uint8Array(viewProps.maxBytes + 1)], 'cover.png', { type: 'image/png' }),
    );
    expect(await screen.findByText(pl.imageAssets.tooLarge)).toBeInTheDocument();
  });

  it('explains missing storage and links to integrations', async () => {
    render(
      <ImageAssetField
        id="logo"
        label="Logo"
        value=""
        onChange={() => undefined}
        {...viewProps}
        testId="logo"
        storageMissing
        onUpload={() => undefined}
      />,
    );

    expect(screen.getByText(pl.imageAssets.storageMissing)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.imageAssets.storageLink })).toHaveAttribute(
      'href',
      '/panel/integrations',
    );
  });
});
