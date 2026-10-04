/**
 * Ответ заглушки `authorCard` — фикстура B2 `tools/card-pipeline/html-layout/fixtures/home-chair.html`
 * дословно (шаг C1 плана `html-layout-authoring_2026-10-05.md`). Встроена константой, а не
 * читается файлом: в рантайме Edge Function файлов инструментов нет. `stub.test.ts` краснеет,
 * пока копия и фикстура расходятся.
 */

export const AUTHORED_FIXTURE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:896px; height:1200px; overflow:hidden; }
  #card * { box-sizing:border-box; }
  #card { font-family:'Montserrat', sans-serif; }
  .kicker {
    position:absolute; top:48px; left:0; width:896px;
    display:flex; justify-content:center;
  }
  .kicker span {
    background:#C8102E; color:#fff; font-weight:700; font-size:22px;
    line-height:38px; height:38px; padding:0 22px; border-radius:19px;
    letter-spacing:0.5px; white-space:nowrap;
  }
  .title {
    position:absolute; top:92px; left:36px; width:824px; text-align:center;
    font-weight:900; font-size:104px; line-height:100px; color:#111;
    text-transform:uppercase; letter-spacing:2px; white-space:nowrap;
  }
  .row {
    position:absolute; left:36px; top:1044px; width:824px; height:108px;
    display:flex; gap:14px;
  }
  .mod {
    flex:1; background:#F1F1F1; border-radius:20px; padding:14px 16px 14px 16px;
    display:flex; align-items:center; gap:12px; min-width:0;
  }
  .num {
    flex:none; width:34px; height:34px; border-radius:50%;
    background:#C8102E; color:#fff; font-weight:700; font-size:18px;
    display:flex; align-items:center; justify-content:center;
  }
  .txt { min-width:0; }
  .lab { font-weight:600; font-size:14px; line-height:17px; color:#6b6b6b; text-transform:uppercase; letter-spacing:0.4px; }
  .val { font-weight:700; font-size:20px; line-height:24px; color:#111; margin-top:4px; }
</style>
</head>
<body>
<div id="card" style="position:relative; width:896px; height:1200px; overflow:hidden">
  <img src="frame.png" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover">

  <div class="kicker"><span>Кресло с ушами</span></div>
  <div class="title">Кресло</div>

  <div class="row">
    <div class="mod">
      <div class="num">1</div>
      <div class="txt">
        <div class="lab">Тип товара</div>
        <div class="val">Кресло-крыло</div>
      </div>
    </div>
    <div class="mod">
      <div class="num">2</div>
      <div class="txt">
        <div class="lab">Дизайн обивки</div>
        <div class="val">Три цветных блока</div>
      </div>
    </div>
    <div class="mod">
      <div class="num">3</div>
      <div class="txt">
        <div class="lab">Материал опор</div>
        <div class="val">Дерево</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`
