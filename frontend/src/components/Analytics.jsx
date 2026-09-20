import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPublicPage } from '../lib/amplitude.js';

export default function Analytics() {
  const { pathname, key } = useLocation();
  useEffect(() => {
    // Query strings, tokens, serials and private panel paths are never sent.
    void trackPublicPage(pathname, key);
  }, [pathname, key]);
  return null;
}
