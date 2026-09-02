-- Веха M7, шаг B0.1: ресурсы Edge-растеризатора. WebAssembly и шрифты не встраиваются в
-- бандл функции: это данные, пополняемые отдельно от релиза. Читает их только service_role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('card-render-assets', 'card-render-assets', false, 5242880,
   array['application/wasm', 'application/json', 'font/ttf']);

-- Политик нет: рендер и процедура загрузки работают с service-role, пользователь этих файлов
-- не видит и не должен иметь возможности подменить шрифт или WebAssembly.
