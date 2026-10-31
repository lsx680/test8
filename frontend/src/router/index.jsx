import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { setNavigator } from '../api/http.js';
import AuthLayout from '../layouts/AuthLayout.jsx';
import AdminLayout from '../layouts/AdminLayout.jsx';
import TeacherLayout from '../layouts/TeacherLayout.jsx';
import StudentLayout from '../layouts/StudentLayout.jsx';
import { AuthBootstrap, HomeRedirect, RedirectIfAuthed, RequireAuth, RequireRole } from './guards.jsx';

/* ---- 懒加载页面：按角色分包，降低首屏体积 ---- */
const Login = lazy(() => import('../pages/auth/Login.jsx'));
const Register = lazy(() => import('../pages/auth/Register.jsx'));

const AdminDashboard = lazy(() => import('../pages/admin/Dashboard.jsx'));
const AdminUsers = lazy(() => import('../pages/admin/Users.jsx'));
const AdminRoles = lazy(() => import('../pages/admin/Roles.jsx'));
const AdminKnowledgePoints = lazy(() => import('../pages/admin/KnowledgePoints.jsx'));
const AdminSupervision = lazy(() => import('../pages/admin/Supervision.jsx'));
const AdminArbitration = lazy(() => import('../pages/admin/Arbitration.jsx'));
const AdminConfig = lazy(() => import('../pages/admin/Config.jsx'));
const AdminAuditLogs = lazy(() => import('../pages/admin/AuditLogs.jsx'));

const TeacherDashboard = lazy(() => import('../pages/teacher/Dashboard.jsx'));
const QuestionBank = lazy(() => import('../pages/teacher/QuestionBank.jsx'));
const QuestionEdit = lazy(() => import('../pages/teacher/QuestionEdit.jsx'));
const PaperList = lazy(() => import('../pages/teacher/PaperList.jsx'));
const PaperCompose = lazy(() => import('../pages/teacher/PaperCompose.jsx'));
const ExamList = lazy(() => import('../pages/teacher/ExamList.jsx'));
const ExamEdit = lazy(() => import('../pages/teacher/ExamEdit.jsx'));
const ReviewList = lazy(() => import('../pages/teacher/ReviewList.jsx'));
const TeacherStats = lazy(() => import('../pages/teacher/Stats.jsx'));

const StudentDashboard = lazy(() => import('../pages/student/Dashboard.jsx'));
const StudentExamList = lazy(() => import('../pages/student/ExamList.jsx'));
const ExamTaking = lazy(() => import('../pages/student/ExamTaking.jsx'));
const ResultList = lazy(() => import('../pages/student/ResultList.jsx'));
const ResultDetail = lazy(() => import('../pages/student/ResultDetail.jsx'));

const Forbidden = lazy(() => import('../pages/common/Forbidden.jsx'));
const NotFound = lazy(() => import('../pages/common/NotFound.jsx'));

/**
 * 路由表（设计文档 §3.1.9 第（2）节）
 * 角色限制在路由组上生效，页面内部再按权限点控制按钮显隐
 */
export const router = createBrowserRouter([
  {
    element: (
      <>
        <AuthBootstrap />
        <RequireAuth />
      </>
    ),
    children: [
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin/dashboard', element: <AdminDashboard /> },
              { path: '/admin/users', element: <AdminUsers /> },
              { path: '/admin/roles', element: <AdminRoles /> },
              { path: '/admin/knowledge-points', element: <AdminKnowledgePoints /> },
              { path: '/admin/supervision', element: <AdminSupervision /> },
              { path: '/admin/arbitration', element: <AdminArbitration /> },
              { path: '/admin/configs', element: <AdminConfig /> },
              { path: '/admin/audit-logs', element: <AdminAuditLogs /> },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['teacher']} />,
        children: [
          {
            element: <TeacherLayout />,
            children: [
              { path: '/teacher/dashboard', element: <TeacherDashboard /> },
              { path: '/teacher/questions', element: <QuestionBank /> },
              { path: '/teacher/questions/new', element: <QuestionEdit /> },
              { path: '/teacher/questions/:questionId/edit', element: <QuestionEdit /> },
              { path: '/teacher/papers', element: <PaperList /> },
              { path: '/teacher/papers/new', element: <PaperCompose /> },
              { path: '/teacher/papers/:paperId/edit', element: <PaperCompose /> },
              { path: '/teacher/exams', element: <ExamList /> },
              { path: '/teacher/exams/new', element: <ExamEdit /> },
              { path: '/teacher/exams/:examId/edit', element: <ExamEdit /> },
              { path: '/teacher/reviews', element: <ReviewList /> },
              { path: '/teacher/stats', element: <TeacherStats /> },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['student']} />,
        children: [
          {
            element: <StudentLayout />,
            children: [
              { path: '/student/dashboard', element: <StudentDashboard /> },
              { path: '/student/exams', element: <StudentExamList /> },
              { path: '/student/results', element: <ResultList /> },
              { path: '/student/results/:attemptId', element: <ResultDetail /> },
            ],
          },
          // 答题页：独立全屏布局，不含侧边栏与外壳顶栏
          { path: '/student/attempts/:attemptId', element: <ExamTaking /> },
        ],
      },
    ],
  },
  {
    element: (
      <>
        <AuthBootstrap />
        <RedirectIfAuthed />
      </>
    ),
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/register', element: <Register /> },
        ],
      },
    ],
  },
  { path: '/', element: <HomeRedirect /> },
  { path: '/403', element: <Forbidden /> },
  { path: '/500', element: <Forbidden code={500} /> },
  { path: '/404', element: <NotFound /> },
  { path: '*', element: <NotFound /> },
]);

/* 将 SPA 导航能力注入 http 层（401/403 跳转不整页刷新） */
setNavigator((path, options) => router.navigate(path, options));

export default router;
export { Navigate };