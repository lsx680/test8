import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { registerStudent } from '../../api/auth.js';
import { listClasses } from '../../api/users.js';
import { FormField, Input, Select } from '../../components/Form.jsx';
import Button from '../../components/Button.jsx';
import { email, maxLen, minLen, password, required, runRules, username, mapServerErrors } from '../../utils/validate.js';

/**
 * 学生注册申请（REQ-UAM-06）
 * 契约：POST /auth/register（公开）→ { userId, status: 'pending' }
 *
 * 契约缺口：RegisterRequest.classId 必填，但 GET /classes 需要 JWT，
 * 匿名访客无法拉取班级字典。此处尝试加载班级列表；失败时允许手工填写班级编号，
 * 并在界面明确提示联系管理员获取编号（不在前端硬编码班级数据）。
 */
export default function Register() {
  const [form, setForm] = useState({
    username: '',
    realName: '',
    password: '',
    confirmPassword: '',
    email: '',
    classId: '',
    phone: '',
  });
  const [errs, setErrs] = useState({});
  const [classes, setClasses] = useState([]);
  const [classError, setClassError] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    // 公开页面尝试获取班级字典；403/401 时降级为手工输入编号（静默，不弹错误提示）
    listClasses(undefined, { silent: true })
      .then((list) => {
        if (alive) setClasses(Array.isArray(list) ? list : list?.list || []);
      })
      .catch(() => {
        if (alive) setClassError('班级列表需要登录后获取，请联系管理员确认班级编号后手工填写。');
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = (key) => (e) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrs((prev) => ({ ...prev, [key]: undefined }));
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = runRules(form, {
      username: [(v) => username(v)],
      realName: [(v) => required(v, '姓名'), (v) => maxLen(v, 64, '姓名')],
      password: [(v) => password(v)],
      confirmPassword: [(v, values) => (v === values.password ? null : '两次输入的密码不一致')],
      email: [(v) => required(v, '邮箱'), (v) => email(v)],
      classId: [(v) => required(v, '班级')],
      phone: [(v) => maxLen(v, 32, '手机号')],
    });
    setErrs(result.errors);
    if (!result.valid) return;

    setLoading(true);
    try {
      await registerStudent({
        username: form.username.trim(),
        realName: form.realName.trim(),
        password: form.password,
        classId: Number(form.classId),
        email: form.email.trim(),
        ...(form.phone ? { phone: form.phone.trim() } : {}),
      });
      setDone(true);
    } catch (err) {
      const serverErrs = mapServerErrors(err?.errors);
      if (Object.keys(serverErrs).length) setErrs(serverErrs);
      setFormError(err?.displayMessage || err?.message || '提交失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-visual">
        <div className="auth-orb" aria-hidden="true" />
        <div className="auth-brand">
          <span className="brand-mark">OES</span>
          <span className="brand-text">
            <span className="brand-name">在线考试系统</span>
            <span className="brand-sub">Student Registration</span>
          </span>
        </div>

        <div className="auth-hero">
          <div className="auth-eyebrow">
            <span className="dot" aria-hidden="true" />
            SIGN UP · 学生注册申请
          </div>
          <h1 className="auth-title">
            <span>加入考试系统</span>
            <span className="neon-text">从一次申请开始</span>
          </h1>
          <p className="auth-lead">
            填写学号、姓名与班级提交申请。为保障考试数据安全，账号需管理员审核通过后生效；
            审核结果与考试通知将通过站内消息送达。
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <i>01</i>
              <div>
                <b>提交申请</b>
                <span>学号将作为唯一登录标识，请确保与教务系统一致</span>
              </div>
            </div>
            <div className="auth-feature">
              <i>02</i>
              <div>
                <b>管理员审核</b>
                <span>审核通过前账号状态为「待审核」，不可登录</span>
              </div>
            </div>
            <div className="auth-feature">
              <i>03</i>
              <div>
                <b>参加考试</b>
                <span>考试发布后在工作台查看可参加考试与剩余次数</span>
              </div>
            </div>
            <div className="auth-feature">
              <i>04</i>
              <div>
                <b>查询成绩</b>
                <span>成绩发布后可查看逐题得分、评语并发起复核申诉</span>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-foot">
          <span>密码要求 <b>≥8 位 · 大小写 + 数字</b></span>
          <span>账号状态 <b>pending → active</b></span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card on-dark" style={{ width: 'min(460px, 100%)' }}>
          <div className="auth-card-head">
            <h2 className="auth-card-title">学生注册申请</h2>
            <p className="auth-card-desc">带 * 为必填项；提交后请等待管理员审核</p>
          </div>

          {done ? (
            <>
              <div className="auth-notice" role="status">
                申请已提交成功，账号状态为「待审核」。管理员审核通过后即可使用学号与密码登录。
              </div>
              <Link to="/login">
                <Button variant="primary" block>
                  返回登录
                </Button>
              </Link>
            </>
          ) : (
            <>
              {formError ? (
                <div className="auth-error" role="alert">
                  <span aria-hidden="true">!</span>
                  <span>{formError}</span>
                </div>
              ) : null}

              <form onSubmit={handleSubmit} noValidate>
                <FormField label="学号" required error={errs.username} htmlFor="reg-username" hint="4~32 位字母、数字、下划线或短横线">
                  <Input
                    id="reg-username"
                    placeholder="如 S2024010"
                    value={form.username}
                    invalid={Boolean(errs.username)}
                    onChange={update('username')}
                    autoComplete="username"
                  />
                </FormField>

                <div className="field-row">
                  <FormField label="姓名" required error={errs.realName} htmlFor="reg-realname">
                    <Input
                      id="reg-realname"
                      placeholder="真实姓名"
                      value={form.realName}
                      invalid={Boolean(errs.realName)}
                      onChange={update('realName')}
                    />
                  </FormField>
                  <FormField label="班级" required error={errs.classId || classError} htmlFor="reg-class">
                    {classes.length ? (
                      <Select
                        id="reg-class"
                        invalid={Boolean(errs.classId)}
                        value={form.classId}
                        onChange={update('classId')}
                      >
                        <option value="">请选择班级</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.className}（{c.classCode}）
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id="reg-class"
                        type="number"
                        min="1"
                        placeholder="班级编号 classId"
                        value={form.classId}
                        invalid={Boolean(errs.classId)}
                        onChange={update('classId')}
                      />
                    )}
                  </FormField>
                </div>

                <FormField label="邮箱" required error={errs.email} htmlFor="reg-email">
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="name@example.com"
                    value={form.email}
                    invalid={Boolean(errs.email)}
                    onChange={update('email')}
                    autoComplete="email"
                  />
                </FormField>

                <div className="field-row">
                  <FormField label="密码" required error={errs.password} htmlFor="reg-password" hint="不少于 8 位，含大小写字母与数字">
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="设置登录密码"
                      value={form.password}
                      invalid={Boolean(errs.password)}
                      onChange={update('password')}
                      autoComplete="new-password"
                    />
                  </FormField>
                  <FormField label="确认密码" required error={errs.confirmPassword} htmlFor="reg-confirm">
                    <Input
                      id="reg-confirm"
                      type="password"
                      placeholder="再次输入密码"
                      value={form.confirmPassword}
                      invalid={Boolean(errs.confirmPassword)}
                      onChange={update('confirmPassword')}
                      autoComplete="new-password"
                    />
                  </FormField>
                </div>

                <FormField label="手机号" error={errs.phone} htmlFor="reg-phone" hint="选填，用于接收考试通知">
                  <Input
                    id="reg-phone"
                    placeholder="选填"
                    value={form.phone}
                    invalid={Boolean(errs.phone)}
                    onChange={update('phone')}
                  />
                </FormField>

                <Button type="submit" variant="primary" block loading={loading}>
                  提交注册申请
                </Button>
              </form>

              <div className="auth-switch">
                已有账号？<Link to="/login">返回登录</Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}