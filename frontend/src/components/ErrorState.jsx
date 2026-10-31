/**
 * 明确错误态：接口不可用时展示原因与重试入口（不使用假数据兜底）
 */
import Button from './Button.jsx';

export default function ErrorState({
  title = '数据加载失败',
  message = '接口暂不可用，请稍后重试。',
  onRetry,
  retryText = '重新加载',
  minHeight = 220,
}) {
  return (
    <div className="state-box state-error" style={{ minHeight }} role="alert">
      <span className="state-icon" aria-hidden="true">
        !
      </span>
      <span className="state-title">{title}</span>
      <span className="state-desc">{message}</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryText}
        </Button>
      ) : null}
    </div>
  );
}