import { app } from 'electron';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import { Creds } from 'utils/types';
import { rendererLog } from './helpers';
import type { Main } from 'main';

export function getUrlAndTokenString(): Creds {
  const inProduction = app.isPackaged;
  const empty: Creds = { errorLogUrl: '', telemetryUrl: '', tokenString: '' };
  let errLogCredsPath = path.join(
    process.resourcesPath,
    '../creds/log_creds.txt'
  );
  if (!fs.existsSync(errLogCredsPath)) {
    errLogCredsPath = path.join(__dirname, '..', '..', 'log_creds.txt');
  }

  if (!fs.existsSync(errLogCredsPath)) {
    // eslint-disable-next-line no-console
    !inProduction && console.log(`${errLogCredsPath} doesn't exist, can't log`);
    return empty;
  }

  let apiKey, apiSecret, errorLogUrl, telemetryUrl;
  try {
    [apiKey, apiSecret, errorLogUrl, telemetryUrl] = fs
      .readFileSync(errLogCredsPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((f) => f.length);
  } catch (err) {
    if (!inProduction) {
      // eslint-disable-next-line no-console
      console.log(`logging error using creds at: ${errLogCredsPath} failed`);
      // eslint-disable-next-line no-console
      console.log(err);
    }
    return empty;
  }

  if (!apiKey || !apiSecret || !errorLogUrl || !telemetryUrl) {
    if (!inProduction) {
      // eslint-disable-next-line no-console
      console.log(
        `logging creds are incomplete at: ${errLogCredsPath}, telemetry disabled`
      );
    }
    return empty;
  }

  const safeEncode = (url: string) => {
    try {
      return encodeURI(url);
    } catch {
      return '';
    }
  };

  return {
    errorLogUrl: safeEncode(errorLogUrl),
    telemetryUrl: safeEncode(telemetryUrl),
    tokenString: `token ${apiKey}:${apiSecret}`,
  };
}

export async function sendError(body: string, main: Main) {
  const { errorLogUrl, tokenString } = getUrlAndTokenString();
  const headers = {
    Authorization: tokenString,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  await fetch(errorLogUrl, { method: 'POST', headers, body }).catch((err) => {
    rendererLog(main, err);
  });
}
