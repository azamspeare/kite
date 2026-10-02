import { api } from '../api';
import { toastError } from '../store';

/** What the tooltips call the file browser the server opens (the server runs on this same machine). */
export const FILE_MANAGER = navigator.userAgent.includes('Mac') ? 'Finder' : 'the file manager';

export async function revealFile(path: string) {
  await api.reveal(path).catch(toastError);
}
