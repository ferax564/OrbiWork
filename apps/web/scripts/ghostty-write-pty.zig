// t3_write_pty matches the committed vendor wasm and the runtime.ts import table; rename all three together.
extern "env" fn t3_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void;

export fn ghostty_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void {
    t3_write_pty(terminal, userdata, data, len);
}
