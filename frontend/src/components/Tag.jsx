/**
 * 状态标签
 * tone: neutral | cyan | violet | green | amber | red
 */
import { cx } from '../utils/format.js';

const TONE_CLASS = {
  neutral: 'tag-neutral',
  cyan: 'tag-cyan',
  violet: 'tag-violet',
  green: 'tag-green',
  amber: 'tag-amber',
  red: 'tag-red',
};

export default function Tag({ tone = 'neutral', children, className, title }) {
  return (
    <span className={cx('tag', TONE_CLASS[tone] || TONE_CLASS.neutral, className)} title={title}>
      {children}
    </span>
  );
}