#pragma once

#include "OrbiSourceTextRunShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using OrbiSourceTextRunComponentDescriptor =
    ConcreteComponentDescriptor<OrbiSourceTextRunShadowNode>;

void OrbiSourceTextRunSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
