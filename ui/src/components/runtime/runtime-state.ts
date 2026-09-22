const dirtySources = new Set<string>()
export function setRuntimeDirty(source: string, dirty: boolean) { if (dirty) dirtySources.add(source); else dirtySources.delete(source) }
export function runtimeDirty() { return dirtySources.size > 0 }
