#import "OrbiSourceTextRun.h"
#import <React/RCTFabricComponentsPlugins.h>
#import "OrbiSourceTextRunComponentDescriptor.h"
#import <react/renderer/components/OrbiSourceTextSpec/Props.h>
#import <react/renderer/components/OrbiSourceTextSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface OrbiSourceTextRun () <RCTT3SourceTextRunViewProtocol>

@end

@implementation OrbiSourceTextRun {
  NSString *_text;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      OrbiSourceTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps =
        std::make_shared<const OrbiSourceTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  const auto &oldViewProps =
      *std::static_pointer_cast<OrbiSourceTextRunProps const>(_props);
  const auto &newViewProps =
      *std::static_pointer_cast<OrbiSourceTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> OrbiSourceTextRunCls(void) {
  return OrbiSourceTextRun.class;
}

@end
