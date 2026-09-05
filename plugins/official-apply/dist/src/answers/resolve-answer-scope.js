function answersError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
export function resolveAnswerScope(input) {
    const type = input.canonical.answerScope;
    switch (type) {
        case 'global':
            return { type, key: 'user' };
        case 'company': {
            if (input.companyKey === undefined || input.companyKey === '') {
                throw answersError('answer_scope_key_missing', `${input.canonical.key} 需要公司范围，但没有 companyKey`);
            }
            return { type, key: `company:${input.companyKey}` };
        }
        case 'job': {
            if (input.jobKey === undefined || input.jobKey === '') {
                throw answersError('answer_scope_key_missing', `${input.canonical.key} 需要岗位范围，但没有 jobKey`);
            }
            // 岗位 key 带上公司，避免两家公司的同名岗位串答案。
            const prefix = input.companyKey === undefined ? '' : `${input.companyKey}:`;
            return { type, key: `job:${prefix}${input.jobKey}` };
        }
        case 'application': {
            if (input.taskId === undefined || input.taskId === '') {
                throw answersError('answer_scope_key_missing', `${input.canonical.key} 需要本次申请范围，但没有 taskId`);
            }
            return { type, key: `application:${input.taskId}` };
        }
        case 'session': {
            if (input.sessionId === undefined || input.sessionId === '') {
                throw answersError('answer_scope_key_missing', `${input.canonical.key} 需要会话范围，但没有 sessionId`);
            }
            return { type, key: `session:${input.sessionId}` };
        }
        case 'profile_record': {
            if (input.profileRecordKey === undefined || input.profileRecordKey === '') {
                // 官网把这个字段单独放着，没有做成可重复的经历卡片
                // （比如只问一个「实习公司」，不是一组经历）。
                // 这时候没有记录可绑，但答案仍然要存得下来。
                //
                // 退到「只对本次申请有效」——它比 global 窄，不会串到别的公司去，
                // 而且保存和下次查找用的是同一个 key，不会出现存得进查不到。
                if (input.taskId !== undefined && input.taskId !== '') {
                    return { type: 'application', key: `application:${input.taskId}` };
                }
                throw answersError('answer_scope_key_missing', `${input.canonical.key} 属于某条履历记录，但既没有 profileRecordKey 也没有 taskId`);
            }
            return { type, key: `profile_record:${input.profileRecordKey}` };
        }
    }
}
/**
 * 判断一条已保存答案的 scope 能不能用在当前场景。
 *
 * 只有 type 和 key **完全一致**才算可复用。
 * 不做任何「差不多就行」的放宽。
 */
export function isScopeUsable(saved, current) {
    return saved.type === current.type && saved.key === current.key;
}
/** session 范围的值绝不进长期答案库（`docs/05 §4.6`）。 */
export function isPersistableScope(scope) {
    return scope.type !== 'session';
}
//# sourceMappingURL=resolve-answer-scope.js.map