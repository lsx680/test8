/**
 * 倒计时展示组件
 * 说明：本组件只负责展示；剩余秒数的权威来源是服务端。
 * 答题页每 30 秒用 GET /attempts/{id}/remaining-time 校准，本地仅按秒递减渲染。
 */
import { formatDuration, cx } from '../utils/format.js';

export default function Countdown({ seconds = 0, dangerAt = 300, label = '剩余时间' }) {
  const danger = seconds <= dangerAt;
  return (
    <div className={cx('exam-timer', danger && 'danger')} role="timer" aria-live="off">
      <div className="timer-label">
        {label}
        <br />
        {danger ? '请尽快完成并交卷' : '服务端计时'}
      </div>
      <span className="clock">{formatDuration(seconds)}</span>
    </div>
  );
}