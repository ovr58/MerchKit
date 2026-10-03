"""int8-квантование модели выреза — воспроизводимый рецепт кандидата `…-int8`.

Готового int8-экспорта BiRefNet нет ни на Hugging Face, ни в релизах rembg: там только fp32 и
fp16, а fp16 на x86 ORT разворачивает обратно в fp32 и времени не экономит. Поэтому файл
делается здесь, а не качается, и рецепт живёт в репозитории — иначе он невоспроизводим.

    py -3 -m venv .venv && .venv/Scripts/pip install onnx onnxruntime
    .venv/Scripts/python tools/card-pipeline/quantize-int8.py \
        tools/card-pipeline/models/birefnet-general-lite.onnx \
        tools/card-pipeline/models/birefnet-general-lite-int8.onnx

Два шага, и первый неочевиден.

1. **Свернуть `Identity` над инициализаторами.** `quantize_dynamic` берёт только те `MatMul`,
   у которых вес — инициализатор. В экспорте BiRefNet у 28 из них между весом и операцией
   стоит `Identity`, и квантователь молча их пропускает: файл худеет на 10% вместо 4×, а
   fp32-веса остаются лежать в нём мёртвым грузом. Преобразование чисто топологическое,
   `Identity(x) → x`, арифметику не трогает.

   Штатный `onnxruntime.quantization.preprocess` даёт тот же эффект, но на этой модели
   проходит только с `--auto_merge`, а он разруливает конфликты формы «мягким слиянием» и
   попутно оптимизирует граф. Для замера, где сравнивают качество кромки, это лишняя
   неопределённость — берём минимальный путь.

2. **`quantize_dynamic(weight_type=QInt8, reduce_range=True)`.** `reduce_range` не украшение:
   цель — Zen 3 (EPYC 7763) без VNNI, где u8s8-ядра ORT насыщаются на полном диапазоне весов.

MD5 полученного файла записывается в план: без него неясно, те ли байты мерили.
"""

import hashlib
import sys
import time

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic


def fold_identity(src: str, dst: str) -> int:
    """`Identity` над инициализатором заменяется самим инициализатором. Возвращает счётчик."""
    model = onnx.load(src)
    initializers = {i.name for i in model.graph.initializer}
    graph_outputs = {o.name for o in model.graph.output}

    rename: dict[str, str] = {}
    keep = []
    for node in model.graph.node:
        # Выход, объявленный выходом графа, сворачивать нельзя: он часть контракта модели.
        if node.op_type == 'Identity' and node.input[0] in initializers and node.output[0] not in graph_outputs:
            rename[node.output[0]] = node.input[0]
        else:
            keep.append(node)

    for node in keep:
        for index, name in enumerate(node.input):
            if name in rename:
                node.input[index] = rename[name]

    del model.graph.node[:]
    model.graph.node.extend(keep)
    onnx.checker.check_model(model, full_check=False)
    onnx.save(model, dst)
    return len(rename)


def md5(path: str) -> str:
    digest = hashlib.md5()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    folded = f'{dst}.folded.tmp.onnx'

    started = time.time()
    print(f'свёрнуто Identity: {fold_identity(src, folded)}')
    quantize_dynamic(folded, dst, weight_type=QuantType.QInt8, reduce_range=True)

    import os

    os.remove(folded)
    print(f'{dst}\n  {os.path.getsize(dst) / 1048576:.1f} МБ, MD5 {md5(dst)}, за {time.time() - started:.0f} с')


if __name__ == '__main__':
    main()
