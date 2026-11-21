import { useEffect, useEffectEvent, useRef } from 'react';
import { Box } from '@mui/material';

import { parseGeowidgetPoint } from './index.web.js';
import type { PickedPickupPoint } from './core/events.js';
import { useFullNavigationExit } from './use-full-navigation-exit.js';

const GEOWIDGET_ORIGIN = 'https://geowidget.inpost.pl';
const GEOWIDGET_POINT_EVENT = 'together-inpost-point';
const GEOWIDGET_ESCAPE_EVENT = 'inpost.geowidget.escape';
const GEOWIDGET_INIT_EVENT = 'inpost.geowidget.init';
const GEOWIDGET_SCRIPT_ID = 'inpost-geowidget-script';

const ensureGeowidgetAssets = (): HTMLScriptElement => {
  if (document.getElementById('inpost-geowidget-style') === null) {
    const style = document.createElement('link');
    style.id = 'inpost-geowidget-style';
    style.rel = 'stylesheet';
    style.href = `${GEOWIDGET_ORIGIN}/inpost-geowidget.css`;
    document.head.append(style);
  }
  const existing = document.getElementById(GEOWIDGET_SCRIPT_ID);
  if (existing instanceof HTMLScriptElement) return existing;
  const script = document.createElement('script');
  script.id = GEOWIDGET_SCRIPT_ID;
  script.src = `${GEOWIDGET_ORIGIN}/inpost-geowidget.js`;
  script.defer = true;
  document.head.append(script);
  return script;
};

const showPointOnMap = (event: Event, code: string) => {
  const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
  const api: unknown = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'api') : undefined;
  const showPoint: unknown = typeof api === 'object' && api !== null ? Reflect.get(api, 'showPoint') : undefined;
  if (typeof showPoint !== 'function') return;
  Promise.resolve(code).then((name) => Reflect.apply(showPoint, api, [name])).catch(() => undefined);
};

export const InpostGeowidget = ({ token, language, shownCode, onPoint, onEscape, onFailed }: {
  token: string;
  language: 'pl' | 'en';
  shownCode: string | null;
  onPoint: (point: PickedPickupPoint) => void;
  onEscape: () => void;
  onFailed: () => void;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const armFullNavigationExit = useFullNavigationExit();
  const pointPicked = useEffectEvent((point: PickedPickupPoint) => onPoint(point));
  const escaped = useEffectEvent(() => onEscape());
  const failed = useEffectEvent(() => onFailed());
  const mapReady = useEffectEvent((event: Event) => {
    if (shownCode !== null) showPointOnMap(event, shownCode);
  });

  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    const script = ensureGeowidgetAssets();
    armFullNavigationExit();
    const widget = document.createElement('inpost-geowidget');
    widget.setAttribute('token', token);
    widget.setAttribute('language', language);
    widget.setAttribute('config', 'parcelCollect');
    widget.setAttribute('onpoint', GEOWIDGET_POINT_EVENT);
    host.replaceChildren(widget);
    const onPointEvent = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const details: unknown = Reflect.get(event, 'details');
      const point = parseGeowidgetPoint(detail ?? details);
      if (point !== null) pointPicked(point);
    };
    const onEscapeEvent = () => escaped();
    const onInitEvent = (event: Event) => mapReady(event);
    const onScriptError = () => {
      script.remove();
      failed();
    };
    document.addEventListener(GEOWIDGET_POINT_EVENT, onPointEvent);
    widget.addEventListener(GEOWIDGET_ESCAPE_EVENT, onEscapeEvent);
    widget.addEventListener(GEOWIDGET_INIT_EVENT, onInitEvent);
    script.addEventListener('error', onScriptError);
    return () => {
      document.removeEventListener(GEOWIDGET_POINT_EVENT, onPointEvent);
      widget.removeEventListener(GEOWIDGET_ESCAPE_EVENT, onEscapeEvent);
      widget.removeEventListener(GEOWIDGET_INIT_EVENT, onInitEvent);
      script.removeEventListener('error', onScriptError);
      host.replaceChildren();
    };
  }, [armFullNavigationExit, language, token]);

  return (
    <Box
      ref={container}
      data-testid="checkout-inpost-geowidget"
      sx={{ position: 'absolute', inset: 0, '& > inpost-geowidget': { display: 'block', width: '100%', height: '100%' } }}
    />
  );
};
