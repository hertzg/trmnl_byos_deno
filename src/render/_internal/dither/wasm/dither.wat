(module
 (type $0 (func (param i32 i32 i32 i32 i32 i32)))
 (memory $0 0)
 (export "ditherFromRgba" (func $src/render/_internal/dither/wasm/dither.as/ditherFromRgba))
 (export "memory" (memory $0))
 (func $src/render/_internal/dither/wasm/dither.as/ditherFromRgba (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 f32)
  (local $10 i32)
  (local $11 i32)
  (local $12 v128)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 f32)
  (local $18 f32)
  (local $19 f32)
  (local $20 f32)
  local.get $3
  i32.const 2
  i32.add
  i32.const 2
  i32.shl
  local.set $11
  local.get $3
  local.tee $7
  i32.const 2
  i32.shl
  local.set $13
  local.get $1
  local.set $3
  local.get $7
  i32.const 2
  i32.shr_s
  local.set $16
  loop $for-loop|0
   local.get $4
   local.get $14
   i32.gt_s
   if
    local.get $3
    f32.const 0
    f32.store
    local.get $0
    local.set $6
    local.get $3
    i32.const 4
    i32.add
    local.set $8
    i32.const 0
    local.set $10
    loop $for-loop|1
     local.get $10
     local.get $16
     i32.lt_s
     if
      local.get $8
      v128.const i32x4 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0 0x3e59b3d0
      local.get $6
      v128.load
      local.tee $12
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      i8x16.shuffle 0 16 16 16 4 16 16 16 8 16 16 16 12 16 16 16
      f32x4.convert_i32x4_s
      f32x4.mul
      v128.const i32x4 0x3f371759 0x3f371759 0x3f371759 0x3f371759
      local.get $12
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      i8x16.shuffle 1 16 16 16 5 16 16 16 9 16 16 16 13 16 16 16
      f32x4.convert_i32x4_s
      f32x4.mul
      f32x4.add
      v128.const i32x4 0x3d93dd98 0x3d93dd98 0x3d93dd98 0x3d93dd98
      local.get $12
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      i8x16.shuffle 2 16 16 16 6 16 16 16 10 16 16 16 14 16 16 16
      f32x4.convert_i32x4_s
      f32x4.mul
      f32x4.add
      v128.store
      local.get $6
      i32.const 16
      i32.add
      local.set $6
      local.get $8
      i32.const 16
      i32.add
      local.set $8
      local.get $10
      i32.const 1
      i32.add
      local.set $10
      br $for-loop|1
     end
    end
    local.get $3
    i32.const 4
    i32.add
    local.get $13
    i32.add
    local.set $10
    loop $while-continue|2
     local.get $8
     local.get $10
     i32.lt_u
     if
      local.get $8
      local.get $6
      i32.load8_u
      f32.convert_i32_u
      f32.const 0.2125999927520752
      f32.mul
      local.get $6
      i32.load8_u offset=1
      f32.convert_i32_u
      f32.const 0.7152000069618225
      f32.mul
      f32.add
      local.get $6
      i32.load8_u offset=2
      f32.convert_i32_u
      f32.const 0.0722000002861023
      f32.mul
      f32.add
      f32.store
      local.get $6
      i32.const 4
      i32.add
      local.set $6
      local.get $8
      i32.const 4
      i32.add
      local.set $8
      br $while-continue|2
     end
    end
    local.get $8
    f32.const 0
    f32.store
    local.get $0
    local.get $13
    i32.add
    local.set $0
    local.get $3
    local.get $11
    i32.add
    local.set $3
    local.get $14
    i32.const 1
    i32.add
    local.set $14
    br $for-loop|0
   end
  end
  local.get $3
  local.get $11
  i32.add
  local.set $0
  loop $while-continue|3
   local.get $0
   local.get $3
   i32.gt_u
   if
    local.get $3
    f32.const 0
    f32.store
    local.get $3
    i32.const 4
    i32.add
    local.set $3
    br $while-continue|3
   end
  end
  f32.const 255
  i32.const 1
  local.get $5
  i32.shl
  i32.const 1
  i32.sub
  f32.convert_i32_s
  local.tee $9
  f32.div
  local.set $19
  local.get $9
  f32.const 255
  f32.div
  local.set $17
  local.get $19
  f32.const 0.4375
  f32.mul
  local.set $18
  v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
  local.get $19
  f32.const 3
  f32.mul
  f32.const 0.0625
  f32.mul
  f32x4.replace_lane 0
  local.get $19
  f32.const 5
  f32.mul
  f32.const 0.0625
  f32.mul
  f32x4.replace_lane 1
  local.get $19
  f32.const 0.0625
  f32.mul
  f32x4.replace_lane 2
  local.set $12
  local.get $1
  i32.const 4
  i32.add
  local.set $5
  loop $for-loop|4
   local.get $4
   local.get $15
   i32.gt_s
   if
    local.get $2
    local.set $3
    local.get $13
    local.get $5
    local.tee $0
    i32.add
    local.set $6
    loop $while-continue|5
     local.get $0
     local.get $6
     i32.lt_u
     if
      local.get $3
      local.get $0
      f32.load
      local.tee $20
      local.get $17
      f32.mul
      f32.nearest
      f32.const 0
      f32.max
      local.get $9
      f32.min
      local.tee $19
      i32.trunc_sat_f32_s
      i32.store8
      local.get $0
      i32.const 4
      i32.add
      local.tee $1
      local.get $1
      f32.load
      local.get $20
      f32.const 0.4375
      f32.mul
      f32.add
      local.get $19
      local.get $18
      f32.mul
      f32.sub
      f32.store
      local.get $0
      local.get $11
      i32.add
      i32.const 4
      i32.sub
      local.tee $0
      local.get $0
      v128.load
      local.get $20
      f32x4.splat
      v128.const i32x4 0x3e400000 0x3ea00000 0x3d800000 0x00000000
      f32x4.mul
      f32x4.add
      local.get $19
      f32x4.splat
      local.get $12
      f32x4.mul
      f32x4.sub
      v128.store
      local.get $1
      local.set $0
      local.get $3
      i32.const 1
      i32.add
      local.set $3
      br $while-continue|5
     end
    end
    local.get $5
    local.get $11
    i32.add
    local.set $5
    local.get $2
    local.get $7
    i32.add
    local.set $2
    local.get $15
    i32.const 1
    i32.add
    local.set $15
    br $for-loop|4
   end
  end
 )
)
