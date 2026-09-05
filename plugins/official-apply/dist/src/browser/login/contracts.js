export function redactLoginPageUrl(raw) {
    try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
    }
    catch {
        return 'about:blank';
    }
}
//# sourceMappingURL=contracts.js.map