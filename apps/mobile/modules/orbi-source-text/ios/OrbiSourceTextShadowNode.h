#pragma once

#include <react/renderer/components/OrbiSourceTextSpec/EventEmitters.h>
#include <react/renderer/components/OrbiSourceTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

extern const char OrbiSourceTextComponentName[];

class OrbiSourceTextStateReal final {
public:
  AttributedString attributedString;
};

class OrbiSourceTextShadowNode final
    : public ConcreteViewShadowNode<OrbiSourceTextComponentName,
                                    OrbiSourceTextProps, OrbiSourceTextEventEmitter,
                                    OrbiSourceTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  OrbiSourceTextShadowNode(const ShadowNode &sourceShadowNode,
                         const ShadowNodeFragment &fragment);

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size
  measureContent(const LayoutContext &layoutContext,
                 const LayoutConstraints &layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
};
} // namespace facebook::react
