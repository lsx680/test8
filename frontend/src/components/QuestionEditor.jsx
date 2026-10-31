/**
 * 题目编辑器（受控组件）
 * 覆盖五种题型的字段差异：
 * - single/multiple：选项列表 + 正确选项
 * - judge：正确/错误
 * - fill：按空顺序的答案数组
 * - short：采分点（point + score）
 * 校验错误由父页面传入 errors（field -> message），保持 inline 提示。
 */
import { useMemo } from 'react';
import { FormField, Input, Select, Textarea } from './Form.jsx';
import Button from './Button.jsx';
import { QUESTION_TYPE_LABEL, QUESTION_TYPES, DIFFICULTY_LABEL } from '../utils/enums.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const DEFAULT_OPTIONS = () =>
  LETTERS.slice(0, 4).map((key) => ({ key, content: '' }));

const DEFAULT_VALUE = {
  bankId: '',
  knowledgePointId: '',
  questionType: 'single',
  difficulty: 3,
  stem: '',
  options: DEFAULT_OPTIONS(),
  correctAnswer: [],
  scoringPoints: [],
  analysis: '',
  defaultScore: 2,
  status: 'published',
  version: undefined,
};

/** 切换题型时重置与题型强相关的字段 */
export function questionTypeDefaults(type, current = {}) {
  const base = { ...current, questionType: type };
  switch (type) {
    case 'single':
    case 'multiple':
      return {
        ...base,
        options: current.options?.length ? current.options : DEFAULT_OPTIONS(),
        correctAnswer: [],
        scoringPoints: [],
      };
    case 'judge':
      return { ...base, options: undefined, correctAnswer: [], scoringPoints: [] };
    case 'fill':
      return { ...base, options: undefined, correctAnswer: [''], scoringPoints: [] };
    case 'short':
      return { ...base, options: undefined, correctAnswer: [], scoringPoints: [{ point: '', score: '' }] };
    default:
      return base;
  }
}

export function emptyQuestion(defaults = {}) {
  return { ...DEFAULT_VALUE, ...questionTypeDefaults(defaults.questionType || 'single', DEFAULT_VALUE), ...defaults };
}

export default function QuestionEditor({ value, onChange, errors = {}, banks = [], knowledgePoints = [], showStatus = true }) {
  const v = { ...DEFAULT_VALUE, ...value };

  const set = (patch) => onChange?.({ ...v, ...patch });

  const flatKnowledgePoints = useMemo(() => {
    const out = [];
    (knowledgePoints || []).forEach((node) => {
      out.push({ id: node.id, name: node.kpName, level: 1 });
      (node.children || []).forEach((child) =>
        out.push({ id: child.id, name: `${node.kpName} / ${child.kpName}`, level: 2 }),
      );
    });
    return out;
  }, [knowledgePoints]);

  const toggleCorrect = (key) => {
    if (v.questionType === 'single') {
      set({ correctAnswer: [key] });
      return;
    }
    const exists = v.correctAnswer?.includes(key);
    const next = exists ? v.correctAnswer.filter((k) => k !== key) : [...(v.correctAnswer || []), key];
    set({ correctAnswer: next.sort() });
  };

  const updateOption = (index, patch) => {
    const options = (v.options || []).map((opt, i) => (i === index ? { ...opt, ...patch } : opt));
    set({ options });
  };

  const addOption = () => {
    const options = v.options || [];
    if (options.length >= LETTERS.length) return;
    set({ options: [...options, { key: LETTERS[options.length], content: '' }] });
  };

  const removeOption = (index) => {
    const options = (v.options || []).filter((_, i) => i !== index);
    const next = options.map((opt, i) => ({ ...opt, key: LETTERS[i] }));
    const validKeys = next.map((o) => o.key);
    set({ options: next, correctAnswer: (v.correctAnswer || []).filter((k) => validKeys.includes(k)) });
  };

  const updateFill = (index, text) => {
    const next = [...(v.correctAnswer || [])];
    next[index] = text;
    set({ correctAnswer: next });
  };

  return (
    <div>
      <div className="form-grid-3">
        <FormField label="题型" required error={errors.questionType}>
          {(f) => (
            <Select
              id={f.id}
              invalid={f.invalid}
              value={v.questionType}
              onChange={(e) => {
                const next = questionTypeDefaults(e.target.value, v);
                onChange?.(next);
              }}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="所属题库" required error={errors.bankId}>
          {(f) => (
            <Select
              id={f.id}
              invalid={f.invalid}
              value={v.bankId ?? ''}
              onChange={(e) => set({ bankId: e.target.value === '' ? '' : Number(e.target.value) })}
            >
              <option value="">请选择题库</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.bankName}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="知识点" error={errors.knowledgePointId}>
          {(f) => (
            <Select
              id={f.id}
              invalid={f.invalid}
              value={v.knowledgePointId ?? ''}
              onChange={(e) =>
                set({ knowledgePointId: e.target.value === '' ? '' : Number(e.target.value) })
              }
            >
              <option value="">未关联</option>
              {flatKnowledgePoints.map((kp) => (
                <option key={kp.id} value={kp.id}>
                  {kp.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <FormField label="题干" required error={errors.stem} hint="支持多行文本，学生端按原格式展示">
        {(f) => (
          <Textarea
            id={f.id}
            invalid={f.invalid}
            rows={4}
            placeholder="请输入题干内容…"
            value={v.stem}
            onChange={(e) => set({ stem: e.target.value })}
          />
        )}
      </FormField>

      {(v.questionType === 'single' || v.questionType === 'multiple') && (
        <FormField
          label={`选项（${v.questionType === 'single' ? '单选' : '多选'}）`}
          required
          error={errors.options || errors.correctAnswer}
          hint={
            v.questionType === 'single'
              ? '点击左侧圆点标记唯一正确选项'
              : '勾选全部正确选项，多选按系统配置计分'
          }
        >
          <div>
            {(v.options || []).map((opt, index) => (
              <div className="editor-option-row" key={opt.key}>
                <label className="row gap-2" style={{ cursor: 'pointer' }}>
                  <input
                    type={v.questionType === 'single' ? 'radio' : 'checkbox'}
                    name="correct-option"
                    checked={(v.correctAnswer || []).includes(opt.key)}
                    onChange={() => toggleCorrect(opt.key)}
                    aria-label={`标记选项 ${opt.key} 为正确答案`}
                  />
                  <b className="mono">{opt.key}</b>
                </label>
                <Input
                  value={opt.content}
                  placeholder={`选项 ${opt.key} 内容`}
                  onChange={(e) => updateOption(index, { content: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOption(index)}
                  disabled={(v.options || []).length <= 2}
                >
                  删除
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addOption} disabled={(v.options || []).length >= LETTERS.length}>
              + 添加选项
            </Button>
          </div>
        </FormField>
      )}

      {v.questionType === 'judge' && (
        <FormField label="正确答案" required error={errors.correctAnswer}>
          <div className="row gap-4">
            <label className="checkbox-line">
              <input
                type="radio"
                name="judge-answer"
                checked={v.correctAnswer?.[0] === 'true'}
                onChange={() => set({ correctAnswer: ['true'] })}
              />
              正确
            </label>
            <label className="checkbox-line">
              <input
                type="radio"
                name="judge-answer"
                checked={v.correctAnswer?.[0] === 'false'}
                onChange={() => set({ correctAnswer: ['false'] })}
              />
              错误
            </label>
          </div>
        </FormField>
      )}

      {v.questionType === 'fill' && (
        <FormField label="填空题答案" required error={errors.correctAnswer} hint="按空顺序填写，每行对应一个空的答案">
          <div>
            {(v.correctAnswer || ['']).map((ans, index) => (
              <div className="editor-option-row" key={`blank-${index}`} style={{ gridTemplateColumns: '64px 1fr auto' }}>
                <span className="small muted">第 {index + 1} 空</span>
                <Input
                  value={ans}
                  placeholder="该空的正确答案"
                  onChange={(e) => updateFill(index, e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(v.correctAnswer || []).length <= 1}
                  onClick={() => set({ correctAnswer: v.correctAnswer.filter((_, i) => i !== index) })}
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ correctAnswer: [...(v.correctAnswer || []), ''] })}
            >
              + 添加空
            </Button>
          </div>
        </FormField>
      )}

      {v.questionType === 'short' && (
        <FormField
          label="采分点"
          error={errors.scoringPoints}
          hint="采分点分值之和不得超过题目满分；将作为阅卷参考"
        >
          <div>
            {(v.scoringPoints || []).map((sp, index) => (
              <div className="scoring-row" key={`sp-${index}`}>
                <Input
                  value={sp.point}
                  placeholder="采分点描述，如：指出三部分结构"
                  onChange={(e) => {
                    const next = v.scoringPoints.map((item, i) =>
                      i === index ? { ...item, point: e.target.value } : item,
                    );
                    set({ scoringPoints: next });
                  }}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={sp.score}
                  placeholder="分值"
                  onChange={(e) => {
                    const next = v.scoringPoints.map((item, i) =>
                      i === index ? { ...item, score: e.target.value } : item,
                    );
                    set({ scoringPoints: next });
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ scoringPoints: v.scoringPoints.filter((_, i) => i !== index) })}
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ scoringPoints: [...(v.scoringPoints || []), { point: '', score: '' }] })}
            >
              + 添加采分点
            </Button>
          </div>
        </FormField>
      )}

      <div className="form-grid-3">
        <FormField label="默认分值" required error={errors.defaultScore} hint="不小于 0.5 分">
          {(f) => (
            <Input
              id={f.id}
              type="number"
              min="0.5"
              step="0.5"
              invalid={f.invalid}
              value={v.defaultScore}
              onChange={(e) => set({ defaultScore: e.target.value })}
            />
          )}
        </FormField>

        <FormField label="难度" error={errors.difficulty}>
          {(f) => (
            <Select
              id={f.id}
              invalid={f.invalid}
              value={v.difficulty}
              onChange={(e) => set({ difficulty: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d} · {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {showStatus ? (
          <FormField label="状态" error={errors.status}>
            {(f) => (
              <Select
                id={f.id}
                invalid={f.invalid}
                value={v.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                <option value="published">发布</option>
                <option value="draft">草稿</option>
              </Select>
            )}
          </FormField>
        ) : null}
      </div>

      <FormField label="解析" error={errors.analysis} hint="保存后学生仅在成绩详情可见解析">
        {(f) => (
          <Textarea
            id={f.id}
            invalid={f.invalid}
            rows={3}
            value={v.analysis || ''}
            onChange={(e) => set({ analysis: e.target.value })}
            placeholder="说明解题思路与易错点（可选）"
          />
        )}
      </FormField>
    </div>
  );
}