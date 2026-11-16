/** Native tool executable only; passed to execFile, never composed into a shell command. */
export const pythonCommand = () => process.env.EME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
