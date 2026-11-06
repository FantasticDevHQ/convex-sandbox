export const validMachineKey = (key: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key) && key !== "new";
