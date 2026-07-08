import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import type { AuthUser } from './current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** 토큰 검증 후 매 요청마다 역할/권한을 로드 (권한 변경 즉시 반영) */
  async validate(payload: { sub: number }): Promise<AuthUser> {
    const me = await this.auth.buildMe(payload.sub).catch(() => null);
    if (!me) throw new UnauthorizedException();
    return me;
  }
}
