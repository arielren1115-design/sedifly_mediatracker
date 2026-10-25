// Channel from domain (BUILD_SPEC 8.3). Other domains are left to the classifier.
import { bareHost } from './urlParts.js';

const SOCIAL = ['instagram.com', 'linkedin.com', 'tiktok.com', 'facebook.com', 'x.com', 'twitter.com', 'threads.net', 'youtube.com'];
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** @param {string|null} url @returns {'Social'|'Reddit'|'Hacker News'|null} */
export function channelFromUrl(url) {
  const host = bareHost(url || '');
  if (!host) return null;
  if (SOCIAL.some((d) => onDomain(host, d))) return 'Social';
  if (onDomain(host, 'reddit.com')) return 'Reddit';
  if (host === 'news.ycombinator.com') return 'Hacker News';
  return null;
}
