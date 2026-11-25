#pragma once

#include "HybridOrbiHighlightsSpec.hpp"

namespace margelo::nitro::orbihighlights {

class HybridOrbiHighlights : public HybridOrbiHighlightsSpec {
public:
  HybridOrbiHighlights() : HybridObject(TAG) {}

  std::optional<std::shared_ptr<ArrayBuffer>> tokenize(SourceText source,
                                                       double language) override;
};

} // namespace margelo::nitro::orbihighlights
