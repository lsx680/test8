import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/index.jsx';
import ToastHost from './components/Toast.jsx';

/** 页面级懒加载占位（浅色内核区域） */
function RouteFallback() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="spinner" />
      <span className="small">页面加载中…</span>
    </div>
  );
}

/**
 * 根组件：装配路由、懒加载边界与全局提示。
 * 鉴权态由 zustand authStore 管理，启动恢复逻辑在 AuthBootstrap 中执行一次。
 */
export default function App() {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <RouterProvider router={router} />
      </Suspense>
      <ToastHost />
    </>
  );
}