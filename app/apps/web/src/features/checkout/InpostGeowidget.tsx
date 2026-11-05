import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

import { parseGeowidgetPoint, type CheckoutEvent } from './index.web.js';

const GEOWIDGET_ORIGIN = 'https://geowidget.inpost.pl';
const GEOWIDGET_POINT_EVENT = 'together-inpost-point';

const ensureGeowidgetAssets = (): void => {
  if (document.getElementById('inpost-geowidget-style') === null) {
    const style = document.createElement('link');
    style.id = 'inpost-geowidget-style';
    style.rel = 'stylesheet';
    style.href = `${GEOWIDGET_ORIGIN}/inpost-geowidget.css`;
    document.head.append(style);
  }
  if (document.getElementById('inpost-geowidget-script') === null) {
    const script = document.createElement('script');
    script.id = 'inpost-geowidget-script';
    script.src = `${GEOWIDGET_ORIGIN}/inpost-geowidget.js`;
    script.defer = true;
    document.head.append(script);
  }
};

export const InpostGeowidget = ({ token, language, dispatch }: {
  token: string;
  language: 'pl' | 'en';
  dispatch: (event: CheckoutEvent) => void;
}) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    ensureGeowidgetAssets();
    const widget = document.createElement('inpost-geowidget');
    widget.setAttribute('token', token);
    widget.setAttribute('language', language);
    widget.setAttribute('config', 'parcelCollect');
    widget.setAttribute('onpoint', GEOWIDGET_POINT_EVENT);
    host.replaceChildren(widget);
    const onPoint = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const details: unknown = Reflect.get(event, 'details');
      const point = parseGeowidgetPoint(detail ?? details);
      if (point !== null) dispatch({ type: 'pickupPointSelected', point });
    };
    document.addEventListener(GEOWIDGET_POINT_EVENT, onPoint);
    return () => {
      document.removeEventListener(GEOWIDGET_POINT_EVENT, onPoint);
      host.replaceChildren();
    };
  }, [dispatch, language, token]);

  return <Box ref={container} data-testid="checkout-inpost-geowidget" sx={{ height: '26rem', width: '100%', overflow: 'hidden' }} />;
};
