#pragma once

#include <react/renderer/components/OrbiSourceTextSpec/EventEmitters.h>
#include <react/renderer/components/OrbiSourceTextSpec/Props.h>
#include <react/renderer/components/OrbiSourceTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char OrbiSourceTextRunComponentName[];

using OrbiSourceTextRunShadowNode =
    ConcreteViewShadowNode<OrbiSourceTextRunComponentName, OrbiSourceTextRunProps,
                           OrbiSourceTextRunEventEmitter, OrbiSourceTextRunState>;
} // namespace facebook::react
