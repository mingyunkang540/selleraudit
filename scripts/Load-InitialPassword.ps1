$initialFile=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\initial-password-hash.dpapi'
if(Test-Path -LiteralPath $initialFile -PathType Leaf){
 $initialSecure=Get-Content -LiteralPath $initialFile -Raw | ConvertTo-SecureString
 $initialPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($initialSecure)
 try{$env:SELLERAUDIT_INITIAL_PASSWORD_HASH=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($initialPointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($initialPointer);$initialSecure.Dispose()}
}
