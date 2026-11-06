export const HOME_FILE_ROOT = "/home/user/demo";
export const HOME_FILE_BYTES = 65536;
export function validHomeName(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name);
}
export function homePathAllowed(path: string, list = false) {
  return (
    (list && path === HOME_FILE_ROOT) ||
    (path.startsWith(`${HOME_FILE_ROOT}/`) &&
      validHomeName(path.slice(HOME_FILE_ROOT.length + 1)))
  );
}
