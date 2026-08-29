import { Navigate, Route, Routes } from 'react-router'

import { RequireAnon, RequireAuth } from '@/features/auth'
import AuthCallback from '@/screens/AuthCallback'
import Catalog from '@/screens/Catalog'
import ConfirmEmail from '@/screens/ConfirmEmail'
import Generation from '@/screens/Generation'
import NotFound from '@/screens/NotFound'
import Profile from '@/screens/Profile'
import ResetNewPassword from '@/screens/ResetNewPassword'
import ResetRequest from '@/screens/ResetRequest'
import SignIn from '@/screens/SignIn'
import SignUp from '@/screens/SignUp'
import Wizard from '@/screens/Wizard'

/**
 * Карта маршрутов.
 *
 * Четыре группы, и разница между ними — не в защите данных, а в том, кому какой экран
 * осмысленно показывать (данные защищает RLS, см. `features/auth/guards.tsx`):
 *
 *   - только гостю — вход и регистрация;
 *   - только авторизованному — профиль, каталог, отдельная генерация;
 *   - **всем — мастер генерации:** гость проходит его целиком и упирается в перехват
 *     только на «Запустить генерацию» (FR-12), поэтому гварда на нём нет и быть не должно;
 *   - всем — экраны почтовых сценариев. Переход по ссылке из письма создаёт сессию,
 *     поэтому `/reset/new` и `/auth/callback` не могут жить под гвардом гостя.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Navigate replace to="/generate" />} path="/" />

      <Route element={<RequireAnon />}>
        <Route element={<SignIn />} path="/signin" />
        <Route element={<SignUp />} path="/signup" />
      </Route>

      <Route element={<Wizard />} path="/generate" />

      <Route element={<ConfirmEmail />} path="/confirm-email" />
      <Route element={<ResetRequest />} path="/reset" />
      <Route element={<ResetNewPassword />} path="/reset/new" />
      <Route element={<AuthCallback />} path="/auth/callback" />

      <Route element={<RequireAuth />}>
        <Route element={<Profile />} path="/profile" />
        <Route element={<Catalog />} path="/catalog" />
        <Route element={<Generation />} path="/generation/:id" />
      </Route>

      <Route element={<NotFound />} path="*" />
    </Routes>
  )
}
