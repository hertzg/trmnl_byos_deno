(module
 (type $0 (func (param i32 i32 i32)))
 (type $1 (func (param i32 i32 i32 i32 i32 i32 i32)))
 (memory $0 0)
 (export "ditherFromRgb" (func $src/render/_internal/dither/wasm/dither.as/ditherFromRgb))
 (export "memory" (memory $0))
 (func $src/render/_internal/dither/wasm/dither.as/lumaRow (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 v128)
  local.get $1
  i32.const 0
  i32.store16
  local.get $1
  local.get $2
  i32.const 1
  i32.add
  i32.const 1
  i32.shl
  i32.add
  i32.const 0
  i32.store16
  local.get $1
  i32.const 2
  i32.add
  local.set $1
  local.get $0
  local.get $2
  i32.const 3
  i32.mul
  i32.add
  local.set $2
  loop $while-continue|0
   local.get $0
   i32.const 28
   i32.add
   local.get $2
   i32.le_u
   if
    local.get $1
    v128.const i32x4 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0
    local.get $0
    v128.load
    local.tee $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 0 16 16 16 3 16 16 16 6 16 16 16 9 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    v128.const i32x4 0x3f371759 0x3f371759 0x3f371759 0x3f371759
    local.get $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 1 16 16 16 4 16 16 16 7 16 16 16 10 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    f32x4.add
    v128.const i32x4 0x3d93dd98 0x3d93dd98 0x3d93dd98 0x3d93dd98
    local.get $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 2 16 16 16 5 16 16 16 8 16 16 16 11 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    f32x4.add
    v128.const i32x4 0x3f000000 0x3f000000 0x3f000000 0x3f000000
    f32x4.add
    i32x4.trunc_sat_f32x4_s
    v128.const i32x4 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0
    local.get $0
    v128.load offset=12
    local.tee $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 0 16 16 16 3 16 16 16 6 16 16 16 9 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    v128.const i32x4 0x3f371759 0x3f371759 0x3f371759 0x3f371759
    local.get $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 1 16 16 16 4 16 16 16 7 16 16 16 10 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    f32x4.add
    v128.const i32x4 0x3d93dd98 0x3d93dd98 0x3d93dd98 0x3d93dd98
    local.get $3
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 2 16 16 16 5 16 16 16 8 16 16 16 11 16 16 16
    f32x4.convert_i32x4_s
    f32x4.mul
    f32x4.add
    v128.const i32x4 0x3f000000 0x3f000000 0x3f000000 0x3f000000
    f32x4.add
    i32x4.trunc_sat_f32x4_s
    i16x8.narrow_i32x4_s
    v128.store
    local.get $0
    i32.const 24
    i32.add
    local.set $0
    local.get $1
    i32.const 16
    i32.add
    local.set $1
    br $while-continue|0
   end
  end
  loop $while-continue|1
   local.get $0
   local.get $2
   i32.lt_u
   if
    local.get $1
    local.get $0
    i32.load8_u
    f32.convert_i32_u
    f32.const 0.2125999927520752
    f32.mul
    local.get $0
    i32.load8_u offset=1
    f32.convert_i32_u
    f32.const 0.7152000069618225
    f32.mul
    f32.add
    local.get $0
    i32.load8_u offset=2
    f32.convert_i32_u
    f32.const 0.0722000002861023
    f32.mul
    f32.add
    f32.const 0.5
    f32.add
    i32.trunc_sat_f32_s
    i32.store16
    local.get $0
    i32.const 3
    i32.add
    local.set $0
    local.get $1
    i32.const 2
    i32.add
    local.set $1
    br $while-continue|1
   end
  end
 )
 (func $src/render/_internal/dither/wasm/dither.as/ditherFromRgb (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  local.get $4
  i32.const 3
  i32.mul
  local.set $13
  local.get $4
  i32.const 2
  i32.add
  i32.const 1
  i32.shl
  local.set $15
  i32.const 255
  i32.const 1
  local.get $6
  i32.shl
  i32.const 1
  i32.sub
  local.tee $18
  i32.div_s
  local.tee $14
  i32.const 1
  i32.shr_s
  local.set $16
  local.get $0
  local.get $1
  local.get $4
  call $src/render/_internal/dither/wasm/dither.as/lumaRow
  local.get $0
  local.set $6
  local.get $3
  local.set $7
  loop $for-loop|0
   local.get $5
   local.get $10
   i32.gt_s
   if
    local.get $10
    i32.const 1
    i32.add
    local.get $5
    i32.lt_s
    if
     local.get $6
     local.get $13
     i32.add
     local.get $2
     local.get $4
     call $src/render/_internal/dither/wasm/dither.as/lumaRow
    else
     local.get $2
     local.tee $0
     local.get $15
     i32.add
     local.set $3
     loop $while-continue|1
      local.get $0
      local.get $3
      i32.lt_u
      if
       local.get $0
       i32.const 0
       i32.store16
       local.get $0
       i32.const 2
       i32.add
       local.set $0
       br $while-continue|1
      end
     end
    end
    i32.const 0
    local.set $9
    i32.const 0
    local.set $11
    i32.const 0
    local.set $3
    local.get $1
    i32.const 2
    i32.add
    local.set $12
    local.get $2
    local.set $0
    i32.const 0
    local.set $8
    loop $for-loop|2
     local.get $4
     local.get $8
     i32.gt_s
     if
      local.get $7
      local.get $8
      i32.add
      local.get $16
      local.get $12
      i32.load16_s
      local.get $9
      i32.add
      local.tee $2
      i32.add
      local.get $14
      i32.div_s
      local.tee $9
      i32.const 0
      i32.lt_s
      if (result i32)
       i32.const 0
      else
       local.get $18
       local.get $9
       local.get $9
       local.get $18
       i32.gt_s
       select
      end
      local.tee $9
      i32.store8
      local.get $2
      local.get $9
      local.get $14
      i32.mul
      i32.sub
      local.tee $2
      i32.const 7
      i32.mul
      i32.const 8
      i32.add
      i32.const 4
      i32.shr_s
      local.set $9
      local.get $0
      local.get $8
      i32.const 1
      i32.shl
      i32.add
      local.tee $17
      local.get $17
      i32.load16_s
      local.get $11
      local.get $2
      i32.const 3
      i32.mul
      i32.add
      i32.const 8
      i32.add
      i32.const 4
      i32.shr_s
      i32.add
      i32.store16
      local.get $3
      local.get $2
      i32.const 5
      i32.mul
      i32.add
      local.set $11
      local.get $2
      local.set $3
      local.get $12
      i32.const 2
      i32.add
      local.set $12
      local.get $8
      i32.const 1
      i32.add
      local.set $8
      br $for-loop|2
     end
    end
    local.get $0
    local.get $4
    i32.const 1
    i32.shl
    i32.add
    local.tee $2
    local.get $2
    i32.load16_s
    local.get $11
    i32.const 8
    i32.add
    i32.const 4
    i32.shr_s
    i32.add
    i32.store16
    local.get $1
    local.set $2
    local.get $0
    local.set $1
    local.get $6
    local.get $13
    i32.add
    local.set $6
    local.get $4
    local.get $7
    i32.add
    local.set $7
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|0
   end
  end
 )
)
