from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    terms_accepted: bool = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False


class AdminBootstrapRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = None
    full_name: str | None = None


class AdminInvitationRequest(BaseModel):
    email: EmailStr
    role_name: str = Field(default="Admin", pattern="^(Super Admin|Admin)$")


class AcceptInvitationRequest(BaseModel):
    token: str
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    token: str


class RoleOut(BaseModel):
    name: str


class UserOut(BaseModel):
    id: UUID
    full_name: str
    email: str
    is_active: bool
    is_verified: bool
    roles: list[str] = []
    created_at: datetime | None = None
    last_login_at: datetime | None = None


class AuthResponse(BaseModel):
    user: UserOut
    access_token: str | None = None
    token_type: str = "bearer"


class AdminInviteResponse(BaseModel):
    email: EmailStr
    role_name: str
    expires_at: datetime
    invitation_token: str | None = None
    message: str
