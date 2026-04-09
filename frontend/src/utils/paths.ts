const RAW_BASE_URL = import.meta.env.BASE_URL || '/';

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash === '/' ? '' : withoutTrailingSlash;
}

export const APP_BASE_PATH = normalizeBasePath(RAW_BASE_URL);
export const ROUTER_BASENAME = APP_BASE_PATH || undefined;

export function withBasePath(path: string): string {
  if (!path) {
    return APP_BASE_PATH || '/';
  }

  if (ABSOLUTE_URL_PATTERN.test(path) || path.startsWith('//')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!APP_BASE_PATH) {
    return normalizedPath;
  }

  if (
    normalizedPath === APP_BASE_PATH ||
    normalizedPath.startsWith(`${APP_BASE_PATH}/`)
  ) {
    return normalizedPath;
  }

  return `${APP_BASE_PATH}${normalizedPath}`;
}

