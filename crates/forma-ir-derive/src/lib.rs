//! `PageProps` derives the existing FMIR schema and projects Rust values through
//! the declared schema. Consumers use the re-export from `forma-ir`.
#![forbid(unsafe_code)]
use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as Tokens};
use quote::{quote, quote_spanned};
use std::collections::HashSet;
use syn::{parse_macro_input, spanned::Spanned, Data, DeriveInput, Fields, Type};

/// Derive a named props struct or unit enum from the supported closed type set.
#[proc_macro_derive(PageProps, attributes(props))]
pub fn page_props(input: TokenStream) -> TokenStream {
    match expand(parse_macro_input!(input as DeriveInput)) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}
fn source(span: Span) -> Tokens {
    quote_spanned!(span=>::forma_ir::props::PropsSource::new(file!(),line!(),column!()))
}
fn name(attrs: &[syn::Attribute], default: String) -> syn::Result<String> {
    let mut rename = None;
    for attr in attrs.iter().filter(|attr| attr.path().is_ident("props")) {
        let mut found = false;
        attr.parse_nested_meta(|meta| {
            found = true;
            if !meta.path.is_ident("rename") {
                return Err(meta.error("PageProps supports only #[props(rename = \"name\")]"));
            }
            if rename.is_some() {
                return Err(meta.error("duplicate PageProps rename"));
            }
            let value: syn::LitStr = meta.value()?.parse()?;
            if value.value().is_empty() || value.value().chars().any(char::is_control) {
                return Err(syn::Error::new(
                    value.span(),
                    "PageProps rename must be nonempty and contain no control characters",
                ));
            }
            rename = Some(value.value());
            Ok(())
        })?;
        if !found {
            return Err(syn::Error::new(
                attr.span(),
                "PageProps requires #[props(rename = \"name\")]; empty attributes are unsupported",
            ));
        }
    }
    Ok(rename.unwrap_or(default))
}
fn camel(name: &str) -> String {
    let mut output = String::new();
    let mut uppercase = false;
    for character in name.trim_start_matches("r#").chars() {
        if character == '_' {
            uppercase = true;
        } else if uppercase && !output.is_empty() {
            output.extend(character.to_uppercase());
            uppercase = false;
        } else {
            output.push(character);
            uppercase = false;
        }
    }
    output
}
fn supported(ty: &Type) -> syn::Result<()> {
    let Type::Path(path) = ty else {
        return Err(syn::Error::new(ty.span(),"PageProps field must be a supported scalar, SystemTime, Option<T>, Vec<T>, or derived named type"));
    };
    if path.qself.is_some() {
        return Err(syn::Error::new(
            ty.span(),
            "PageProps associated type projections are unsupported",
        ));
    }
    let Some(last) = path.path.segments.last() else {
        return Err(syn::Error::new(ty.span(), "PageProps field has no type"));
    };
    let ident = last.ident.to_string();
    if matches!(
        ident.as_str(),
        "i128"
            | "u128"
            | "char"
            | "str"
            | "HashMap"
            | "BTreeMap"
            | "HashSet"
            | "BTreeSet"
            | "Box"
            | "Rc"
            | "Arc"
            | "Value"
    ) {
        return Err(syn::Error::new(
            ty.span(),
            "unsupported PageProps field type; use the declared closed type set",
        ));
    }
    if ident == "Option" || ident == "Vec" {
        let syn::PathArguments::AngleBracketed(args) = &last.arguments else {
            return Err(syn::Error::new(
                ty.span(),
                "Option and Vec require one props type",
            ));
        };
        if args.args.len() != 1 {
            return Err(syn::Error::new(
                args.span(),
                "Option and Vec require exactly one props type",
            ));
        }
        let Some(syn::GenericArgument::Type(inner)) = args.args.first() else {
            return Err(syn::Error::new(
                args.span(),
                "Option and Vec require a type argument",
            ));
        };
        supported(inner)?;
    } else if !matches!(last.arguments, syn::PathArguments::None) {
        return Err(syn::Error::new(
            ty.span(),
            "generic props types other than Option and Vec are unsupported",
        ));
    }
    Ok(())
}
fn expand(input: DeriveInput) -> syn::Result<Tokens> {
    for attr in &input.attrs {
        if attr.path().is_ident("props") {
            return Err(syn::Error::new(
                attr.span(),
                "props attributes belong on fields or enum variants",
            ));
        }
    }
    if !input.generics.params.is_empty() {
        return Err(syn::Error::new(
            input.generics.span(),
            "PageProps requires a concrete named type without generic parameters",
        ));
    }
    let root_source = source(input.ident.span());
    let ident = &input.ident;
    let (describe, encode) = match &input.data {
        Data::Struct(data) => {
            let Fields::Named(fields) = &data.fields else {
                return Err(syn::Error::new(input.ident.span(),"PageProps structs require named fields; tuple and unit structs are unsupported"));
            };
            let mut names = HashSet::new();
            let mut describe = Vec::new();
            let mut arms = Vec::new();
            for field in &fields.named {
                supported(&field.ty)?;
                let Some(field_ident) = &field.ident else {
                    return Err(syn::Error::new(
                        field.span(),
                        "PageProps requires a named field",
                    ));
                };
                let field_name = name(&field.attrs, camel(&field_ident.to_string()))?;
                if !names.insert(field_name.clone()) {
                    return Err(syn::Error::new(
                        field_ident.span(),
                        format!(
                            "duplicate PageProps field name {field_name:?} after camelCase/rename"
                        ),
                    ));
                }
                let field_source = source(field_ident.span());
                let ty = &field.ty;
                let field_type = quote_spanned!(ty.span()=><#ty as ::forma_ir::props::PropValue>::describe(builder)?);
                describe.push(
                    quote! {{let kind=#field_type;builder.field(#field_name,#field_source,kind)?}},
                );
                let encode = quote_spanned!(ty.span()=>::forma_ir::props::PropValue::encode_value(&self.#field_ident,&child,&field.kind,&child_path)?);
                arms.push(quote!{#field_name=>{let child=context.field(field,#field_source,&child_path)?;if let Some(value)=#encode {values.insert(name.to_owned(),value);}}});
            }
            (
                quote! {builder.object::<Self>(|builder|{Ok(::std::vec![#(#describe),*])})},
                quote! {
                    let mut values=::forma_ir::props::JsonMap::new();
                    for field in context.object(kind,path)? {
                        let name=context.name(field.name,path)?;
                        let child_path=::forma_ir::props::child_path(path,name);
                        match name {#(#arms)* _=>return Err(context.error("RENDER-404",&child_path,"declared field is absent from the Rust handler")),}
                    }
                    Ok(Some(::forma_ir::props::JsonValue::Object(values)))
                },
            )
        }
        Data::Enum(data) => {
            if data.variants.is_empty() {
                return Err(syn::Error::new(
                    input.ident.span(),
                    "PageProps unit enums require at least one variant",
                ));
            }
            let mut names = HashSet::new();
            let mut literals = Vec::new();
            let mut arms = Vec::new();
            for variant in &data.variants {
                if !matches!(variant.fields, Fields::Unit) {
                    return Err(syn::Error::new(
                        variant.fields.span(),
                        "PageProps enum variants must be unit variants without payloads",
                    ));
                }
                if variant.discriminant.is_some() {
                    return Err(syn::Error::new(
                        variant.span(),
                        "PageProps unit enums do not support explicit discriminants",
                    ));
                }
                let literal = name(
                    &variant.attrs,
                    variant
                        .ident
                        .to_string()
                        .trim_start_matches("r#")
                        .to_string(),
                )?;
                if !names.insert(literal.clone()) {
                    return Err(syn::Error::new(
                        variant.ident.span(),
                        format!("duplicate PageProps enum literal {literal:?}"),
                    ));
                }
                let variant_ident = &variant.ident;
                arms.push(quote! {Self::#variant_ident=>#literal,});
                literals.push(literal);
            }
            (
                quote! {builder.enumeration(&[#(#literals),*])},
                quote! {context.enumeration(kind,path,match self{#(#arms)*})},
            )
        }
        Data::Union(data) => {
            return Err(syn::Error::new(
                data.union_token.span,
                "PageProps does not support unions",
            ))
        }
    };
    Ok(quote! {
        impl ::forma_ir::props::PropValue for #ident {
            fn describe(builder:&mut ::forma_ir::props::SchemaBuilder)->::std::result::Result<::forma_ir::schema::PropType,::forma_ir::props::PropsError>{#describe}
            fn encode_value(&self,context:&::forma_ir::props::EncodeContext<'_>,kind:&::forma_ir::schema::PropType,path:&str)->::std::result::Result<::std::option::Option<::forma_ir::props::JsonValue>,::forma_ir::props::PropsError>{#encode}
            fn source()->::forma_ir::props::PropsSource {#root_source}
        }
        impl ::forma_ir::props::PageProps for #ident {}
    })
}
