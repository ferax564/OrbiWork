#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>

@interface OrbiSourceTextManager : RCTViewManager
@end

@implementation OrbiSourceTextManager

RCT_EXPORT_MODULE(OrbiSourceText)

- (UIView *)view {
  return [[UIView alloc] init];
}

@end

@interface OrbiSourceTextRunManager : RCTViewManager
@end

@implementation OrbiSourceTextRunManager

RCT_EXPORT_MODULE(OrbiSourceTextRun)

- (UIView *)view {
  return nil;
}

@end
